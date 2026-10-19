package com.odk.shell

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.odk.shell.bridge.PersonalAgentBridge
import com.odk.shell.link.LinkConfig
import com.odk.shell.link.LinkConfigReader
import com.odk.shell.link.LinkState
import com.odk.shell.link.PersonalAgentLink
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID

/**
 * The Android Shell Host. It shows the renderer every other host shows, so this
 * activity owns host concerns only: asset serving, the platform bridge, the
 * development label and the Back gesture. The renderer owns every design
 * decision, and the desk owns every word the Agent says.
 */
class ShellActivity : Activity() {
    private lateinit var shell: WebView
    private var link: PersonalAgentLink? = null
    private var developmentLabel: TextView? = null
    private var bridge: PersonalAgentBridge? = null
    private var documentEpoch = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The Panel covers the display bounds. A system bar that shortened the
        // viewport would move every measured box, so Android follows ADR-0034 the
        // same way the Windows host does.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        shell = WebView(this)
        shell.setBackgroundColor(Color.BLACK)
        shell.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
        }

        // Verification reads the rendered document over the devtools protocol.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        link = createLink()
        bridge = PersonalAgentBridge(link)
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "This WebView does not support the secure Shell bridge" }
        WebViewCompat.addWebMessageListener(shell, BRIDGE_NAME, setOf(SHELL_ORIGIN)) { view, message, origin, isMainFrame, proxy ->
            if (!PersonalAgentBridge.permitsDocument(view === shell, isMainFrame, origin.toString(), shell.url)) return@addWebMessageListener
            val epoch = documentEpoch
            val payload = message.data ?: return@addWebMessageListener
            bridge?.receive(payload) { response ->
                runOnUiThread {
                    if (!isFinishing && epoch == documentEpoch && shell.url == SHELL_URL) {
                        try { proxy.postMessage(response) } catch (_: Exception) { /* The old document may have closed. */ }
                    }
                }
            }
        }

        // Assets are served from an https origin so the renderer keeps 'self' in
        // its content security policy and localStorage keeps a stable origin.
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler(SHELL_ASSET_PATH, WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        shell.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.isForMainFrame && request.url.toString() != SHELL_URL

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                documentEpoch += 1
                if (url != SHELL_URL) { view.stopLoading(); return }
                super.onPageStarted(view, url, favicon)
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                if (request.isForMainFrame && request.url.toString() != SHELL_URL) {
                    return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                if (request.url.toString() == SHELL_URL) return shellDocument()
                return assetLoader.shouldInterceptRequest(request.url)
            }

            /**
             * The link can go live before the document finishes booting, so the
             * frame the desk already sent is delivered once more. Losing that race
             * would leave a live link showing an unavailable Agent.
             */
            override fun onPageFinished(view: WebView, url: String) {
                if (url == SHELL_URL) link?.let { linkOnFrame(it.currentFrame(), it.isDevelopment()) }
            }
        }

        developmentLabel = developmentLabelView()
        val root = FrameLayout(this)
        root.addView(shell, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(developmentLabel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START))
        setContentView(root)

        shell.loadUrl(SHELL_URL)
    }

    /**
     * The host shim is injected into the served document, exactly as Electron
     * injects its preload script. The staged renderer file itself is never
     * modified, so the renderer stays a single source.
     */
    private fun shellDocument(): WebResourceResponse? {
        val html = try {
            assets.open(STAGED_DOCUMENT).bufferedReader().use { it.readText() }
        } catch (error: Exception) {
            Log.e(TAG, "the staged Shell document is missing", error)
            return null
        }
        val injected = html.replaceFirst("<head>", "<head>\n  <script src=\"" + BRIDGE_SCRIPT + "\"></script>")
        return WebResourceResponse("text/html", "utf-8", ByteArrayInputStream(injected.toByteArray(Charsets.UTF_8)))
    }

    /**
     * The desk marks a frame it produced from its development source. The phone
     * shows that mark as its own chrome, so a reviewed state is never read as
     * personal activity. It is host chrome: the renderer never draws it, and a
     * page screenshot cannot contain it.
     */
    private fun developmentLabelView(): TextView = TextView(this).apply {
        setText(R.string.development_state)
        setTextColor(Color.parseColor("#101010"))
        setBackgroundColor(Color.parseColor("#E0B341"))
        setPadding(28, 10, 28, 10)
        textSize = 12f
        visibility = TextView.GONE
    }

    private fun createLink(): PersonalAgentLink? {
        val config = readLinkConfig() ?: return null
        val machine = "android-" + Build.MODEL.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
        return PersonalAgentLink(config, machine, UUID.randomUUID().toString(), ::linkOnFrame, ::linkOnState).apply { start() }
    }

    private fun readLinkConfig(): LinkConfig? {
        val file = File(filesDir, LINK_CONFIG_FILE)
        if (!file.isFile) return null
        return try {
            LinkConfigReader.read(file.readText())
        } catch (error: Exception) {
            Log.e(TAG, "the provisioned link configuration is unreadable", error)
            null
        }
    }

    private fun linkOnFrame(frame: JSONObject, development: Boolean) {
        deliverToRenderer(
            "window.__odkBridge && window.__odkBridge.deliver('personalAgent', " + JSONObject.quote(frame.toString()) + ")"
        )
        runOnUiThread { developmentLabel?.visibility = if (development) TextView.VISIBLE else TextView.GONE }
    }

    private fun linkOnState(state: LinkState) {
        Log.i(TAG, "Open DeskOS Link: " + when (state) {
            is LinkState.Connecting -> "connecting"
            is LinkState.Live -> if (state.development) "live, development state" else "live"
            is LinkState.Dropped -> "dropped: " + state.reason
        })
    }

    private fun deliverToRenderer(script: String) {
        val epoch = documentEpoch
        runOnUiThread {
            if (!isFinishing && epoch == documentEpoch && shell.url == SHELL_URL) shell.evaluateJavascript(script, null)
        }
    }

    /** A transient bar is allowed for a swipe and then withdrawn again. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    /**
     * The Shell guarantees that Escape restores the source context. On a phone
     * that gesture is Back, so Back reaches the renderer as a key event instead of
     * closing the app.
     */
    @Deprecated("The Shell handles Back itself.")
    override fun onBackPressed() {
        shell.evaluateJavascript(BACK_TO_ESCAPE, null)
    }

    override fun onDestroy() {
        documentEpoch += 1
        bridge?.close()
        bridge = null
        link?.stop()
        link = null
        super.onDestroy()
    }

    private companion object {
        const val TAG = "odk-shell"
        const val BRIDGE_NAME = "ODKAndroid"
        const val SHELL_ASSET_PATH = "/assets/"
        const val SHELL_ORIGIN = "https://appassets.androidplatform.net"
        const val SHELL_URL = "https://appassets.androidplatform.net/assets/web/renderer/index.html"
        const val BRIDGE_SCRIPT = "/assets/host/odk-bridge.js"
        const val STAGED_DOCUMENT = "web/renderer/index.html"
        const val LINK_CONFIG_FILE = "odk-link.json"
        const val BACK_TO_ESCAPE =
            "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
    }
}