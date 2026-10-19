import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
}

// The shared renderer lives with the Shell. Android keeps no copy of it.
val shellRoot = rootProject.layout.projectDirectory.dir("../shell")
val shellSource = shellRoot.dir("src")

/**
 * Stages the shared renderer into the APK asset set. The staged tree is a build
 * output, so a renderer change reaches the next build without entering version
 * control.
 */
abstract class StageRenderer : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val rendererSource: DirectoryProperty

    /**
     * The Shell document loads markdown-it and highlight.js from the Shell's own
     * dependency install, so the staged tree carries them at that same path.
     */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val rendererLibraries: ConfigurableFileCollection

    /** The asset root the WebView asset loader serves at `/assets/`. */
    @get:OutputDirectory
    abstract val assetDirectory: DirectoryProperty

    @get:Inject
    abstract val fileSystem: FileSystemOperations

    @TaskAction
    fun stage() {
        val styles = rendererSource.file("renderer/uno.css").get().asFile
        check(styles.isFile) {
            "Shared renderer styles are missing at " + styles.path +
                ". Run pnpm install and pnpm styles in runtime/shell first."
        }
        val libraries = rendererLibraries.files
        val markdownIt = libraries.singleOrNull { it.name == "markdown-it.umd.min.js" }
        val highlightJs = libraries.singleOrNull { it.name == "highlight.min.js" }
        check(markdownIt != null && markdownIt.isFile && highlightJs != null && highlightJs.isFile) {
            "Shared renderer libraries are missing. Run pnpm install in runtime/shell first."
        }
        fileSystem.sync {
            // Mirrors the Shell root, so a relative path in the document resolves
            // here exactly as it does on the other hosts: `web` holds `src`, and
            // `node_modules` sits beside it.
            into(assetDirectory)
            from(rendererSource) {
                include("plugin-host.js")
                include("renderer/**")
                exclude("renderer/themes/liquid-glass-sdk.js")
                into("web")
            }
            from(markdownIt) { into("node_modules/markdown-it/dist/browser") }
            from(highlightJs) { into("node_modules/@highlightjs/cdn-assets") }
        }
    }
}

val stageRenderer = tasks.register<StageRenderer>("stageRenderer") {
    rendererSource.set(shellSource)
    rendererLibraries.from(
        shellRoot.file("node_modules/markdown-it/dist/browser/markdown-it.umd.min.js"),
        shellRoot.file("node_modules/@highlightjs/cdn-assets/highlight.min.js"),
    )
    assetDirectory.set(layout.buildDirectory.dir("staged-assets"))
}

android {
    namespace = "com.odk.shell"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.odk.shell"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("test") {
            // The contract fixture stays where the desk keeps it, so both ends
            // answer to one file instead of two copies.
            resources.srcDir(shellRoot.dir("tests/fixtures"))
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(stageRenderer) { it.assetDirectory }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}