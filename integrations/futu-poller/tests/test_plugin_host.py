"""Python native factories follow the local versioned-port contract."""
import pytest
import inspect
import asyncio
import gc
from concurrent.futures import Future, ThreadPoolExecutor
from plugin_host import PluginHost
from poller import PollerRuntime


def definition(name, create, requires=()):
    return {"manifest": {"schemaVersion": 1, "id": "odk.futu." + name, "name": name, "version": "1.0.0", "host": "python-agent", "kind": "service", "provides": [{"interface": "odk:futu/" + name + "/v1"}], "requires": [{"interface": port} for port in requires]}, "create": create}


def test_runtime_failure_releases_consumers_before_provider_and_preserves_independent_instance():
    events = []
    host = PluginHost()
    for name, dependencies in [("provider", ()), ("consumer", ("odk:futu/provider/v1",)), ("independent", ())]:
        def create(context, name=name):
            events.append("create " + name)
            return {"ports": {"odk:futu/" + name + "/v1": object()}, "stop": lambda: events.append("stop " + name)}
        host.register(definition(name, create, dependencies))
    host.start()
    independent = host.get("odk:futu/independent/v1")
    error = RuntimeError("private execution error")
    host.fail("odk.futu.provider", error)
    assert events[-2:] == ["stop consumer", "stop provider"]
    assert [entry["state"] for entry in host.catalog()] == ["failed", "blocked", "running"]
    assert host.failure("odk.futu.provider") is error
    assert host.get("odk:futu/independent/v1") is independent
    assert "private execution error" not in str(host.diagnose())
    host.set_enabled("odk.futu.provider", True)
    assert all(entry["state"] == "running" for entry in host.catalog())
    assert host.get("odk:futu/independent/v1") is independent
    host.stop()


@pytest.mark.parametrize("operation", ["start", "close", "run"])
def test_runtime_rejects_foreign_thread_before_changing_errors_or_resources(operation):
    events = []
    retained_error = RuntimeError("retained cleanup failure")
    errors = [retained_error]
    host = PluginHost()
    host.register(definition("provider", lambda context: {
        "ports": {"odk:futu/provider/v1": object()},
        "stop": lambda: events.append("stop"),
    }))
    host.start()
    owned = host.get("odk:futu/provider/v1")
    before = host.catalog()
    runtime = PollerRuntime(host, errors)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pytest.raises(RuntimeError, match="owner thread"):
            pool.submit(getattr(runtime, operation)).result(timeout=5)
    assert errors == [retained_error]
    assert host.catalog() == before
    assert host.get("odk:futu/provider/v1") is owned
    assert events == []
    runtime.close()
    assert errors == []
    assert events == ["stop"]


@pytest.mark.parametrize("operation", ["register", "start", "stop", "enable", "validate", "catalog", "diagnose", "get", "failure", "fail", "generation", "context-get", "capability", "cleanup"])
def test_foreign_thread_cannot_operate_on_owned_plugins(operation):
    events = []
    contexts = []
    host = PluginHost(capabilities={"fixture.read": object()})
    def create(context):
        contexts.append(context)
        events.append("create")
        return {"ports": {"odk:futu/provider/v1": object()}, "stop": lambda: events.append("stop")}
    provider = definition("provider", create)
    provider["manifest"]["permissions"] = ["fixture.read"]
    host.register(provider)
    host.start()
    before = host.catalog()
    owned = host.get("odk:futu/provider/v1")
    operations = {
        "register": lambda: host.register(definition("foreign", lambda context: {})),
        "start": host.start, "stop": host.stop,
        "enable": lambda: host.set_enabled("odk.futu.provider", False),
        "validate": host.validate, "catalog": host.catalog, "diagnose": host.diagnose,
        "get": lambda: host.get("odk:futu/provider/v1"),
        "failure": lambda: host.failure("odk.futu.provider"),
        "fail": lambda: host.fail("odk.futu.provider", RuntimeError("foreign error")),
        "generation": lambda: host.generation("odk.futu.provider"),
        "context-get": lambda: contexts[0].get("odk:futu/provider/v1"),
        "capability": lambda: contexts[0].capability("fixture.read"),
        "cleanup": lambda: contexts[0].on_cleanup(lambda: events.append("foreign cleanup")),
    }
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pytest.raises(RuntimeError, match="owner thread"):
            pool.submit(operations[operation]).result(timeout=5)
    assert host.catalog() == before
    assert host.get("odk:futu/provider/v1") is owned
    assert events == ["create"]
    host.set_enabled("odk.futu.provider", False)
    host.set_enabled("odk.futu.provider", True)
    assert host.diagnose()["state"] == "available"
    host.stop()
    assert events == ["create", "stop", "create", "stop"]


def test_execution_failure_retains_failed_cleanup_until_explicit_retry():
    events = []
    busy = [True]
    host = PluginHost()
    def create(context):
        events.append("create")
        def close():
            events.append("close")
            if busy[0]:
                raise RuntimeError("resource busy")
        context.on_cleanup(close)
        return {"ports": {"odk:futu/provider/v1": object()}}
    host.register(definition("provider", create))
    host.start()
    host.fail("odk.futu.provider", RuntimeError("execution error"))
    assert host.catalog()[0]["state"] == "cleanup-failed"
    assert host.get("odk:futu/provider/v1") is None
    host.set_enabled("odk.futu.provider", True)
    assert events == ["create", "close", "close"]
    busy[0] = False
    host.set_enabled("odk.futu.provider", True)
    assert events == ["create", "close", "close", "close", "create"]
    assert host.catalog()[0]["state"] == "running"
    host.stop()


@pytest.mark.parametrize("phase", ["factory", "start"])
def test_asynchronous_initialization_fails_without_publishing_a_port(phase):
    coroutines = []
    events = []
    async def unsupported():
        events.append("async body")
        return {"ports": {"odk:futu/provider/v1": object()}}
    def create(context):
        context.on_cleanup(lambda: events.append("cleanup"))
        result = unsupported()
        coroutines.append(result)
        if phase == "factory":
            return result
        return {"ports": {"odk:futu/provider/v1": object()}, "start": lambda: result}
    host = PluginHost()
    host.register(definition("provider", create))
    host.start()
    assert host.catalog()[0]["state"] == "failed"
    assert "synchronous" in host.catalog()[0]["error"]
    assert host.get("odk:futu/provider/v1") is None
    assert events == ["cleanup"]
    assert inspect.getcoroutinestate(coroutines[0]) == inspect.CORO_CLOSED
    host.stop()


@pytest.mark.parametrize("phase", ["stop", "destroy", "cleanup"])
def test_asynchronous_shutdown_retains_providers_and_retries_unfinished_work(phase):
    events = []
    coroutines = []
    asynchronous = True
    async def unsupported():
        events.append("async body")
    def operation(name):
        def invoke():
            events.append(name)
            if name == phase and asynchronous:
                result = unsupported()
                coroutines.append(result)
                return result
        return invoke
    host = PluginHost()
    host.register(definition("provider", lambda context: {"ports": {"odk:futu/provider/v1": object()}, "stop": operation("provider")}))
    def create(context):
        context.on_cleanup(operation("cleanup"))
        return {"ports": {"odk:futu/consumer/v1": object()}, "stop": operation("stop"), "destroy": operation("destroy")}
    host.register(definition("consumer", create, ["odk:futu/provider/v1"]))
    host.start()
    host.stop()
    assert [entry["state"] for entry in host.catalog()] == ["cleanup-blocked", "cleanup-failed"]
    assert "provider" not in events
    assert "async body" not in events
    assert inspect.getcoroutinestate(coroutines[0]) == inspect.CORO_CLOSED
    with pytest.raises(RuntimeError, match="still owns resources"):
        host.start()
    asynchronous = False
    host.stop()
    assert all(entry["state"] == "stopped" for entry in host.catalog())
    assert events.count(phase) == 2
    assert events.count("provider") == 1
    host.stop()
    assert events.count(phase) == 2


@pytest.mark.parametrize("enabled", [None, 0, 1, "false", {}, []])
def test_non_boolean_enable_requests_preserve_the_active_instance(enabled):
    events = []
    host = PluginHost()
    host.register(definition("provider", lambda context: {"ports": {"odk:futu/provider/v1": object()}, "stop": lambda: events.append("stop")}))
    host.start()
    source = host.get("odk:futu/provider/v1")
    with pytest.raises(TypeError, match="boolean"):
        host.set_enabled("odk.futu.provider", enabled)
    assert host.get("odk:futu/provider/v1") is source
    assert host.catalog()[0]["state"] == "running"
    assert events == []
    host.stop()
    assert events == ["stop"]


@pytest.mark.parametrize("state", ["failed", "pending", "cancelled"])
def test_rejected_asyncio_future_consumes_failures_without_running_async_work(state):
    loop = asyncio.new_event_loop()
    errors = []
    loop.set_exception_handler(lambda active_loop, context: errors.append(context["message"]))
    def exercise():
        future = loop.create_future()
        if state == "failed":
            future.set_exception(RuntimeError("fixture failure"))
        elif state == "cancelled":
            future.cancel()
        host = PluginHost()
        host.register(definition("provider", lambda context: future))
        host.start()
        assert host.catalog()[0]["state"] == "failed"
        assert "synchronous" in host.catalog()[0]["error"]
        if state == "pending":
            future.set_exception(RuntimeError("fixture delayed failure"))
        loop.run_until_complete(asyncio.sleep(0))
        host.stop()
    try:
        exercise()
        gc.collect()
        assert errors == []
    finally:
        loop.close()


def test_thread_future_and_custom_awaitable_cannot_complete_shutdown():
    class Deferred:
        def __await__(self):
            pytest.fail("the host must not execute an awaitable")
        def close(self):
            pytest.fail("the host must not close arbitrary capability objects")
    for result in [Future(), Deferred()]:
        host = PluginHost()
        host.register(definition("provider", lambda context: {"ports": {"odk:futu/provider/v1": object()}, "stop": lambda: result}))
        host.start()
        host.stop()
        assert host.catalog()[0]["state"] == "cleanup-failed"
        assert "synchronous" in host.catalog()[0]["error"]


def test_graph_starts_providers_and_cleans_consumers_first():
    events = []
    host = PluginHost()
    def factory(name):
        def create(context):
            events.append(name + ".create")
            context.on_cleanup(lambda: events.append(name + ".close"))
            return {"ports": {"odk:futu/" + name + "/v1": object()}}
        return create
    host.register(definition("consumer", factory("consumer"), ["odk:futu/provider/v1"]))
    host.register(definition("provider", factory("provider")))
    host.start(); host.start(); host.stop(); host.stop()
    assert events == ["provider.create", "consumer.create", "consumer.close", "provider.close"]


def test_preflight_does_not_create_resources_for_missing_ports():
    host = PluginHost()
    host.register(definition("consumer", lambda context: pytest.fail("factory started"), ["odk:futu/missing/v1"]))
    with pytest.raises(ValueError, match="missing required port"): host.start()


def test_failure_cleans_partial_factory_and_independent_plugins_survive():
    events = []
    errors = []
    host = PluginHost(on_error=lambda identity, error: errors.append(error))
    def bad(context):
        context.on_cleanup(lambda: events.append("partial.close"))
        raise RuntimeError("fixture")
    host.register(definition("bad", bad))
    host.register(definition("independent", lambda context: {"ports": {"odk:futu/independent/v1": object()}}))
    host.start()
    assert events == ["partial.close"]
    assert [entry["state"] for entry in host.catalog()] == ["failed", "running"]
    assert str(errors[0]) == "fixture"
    host.stop()


def test_cleanup_failure_does_not_skip_other_resources():
    events = []
    host = PluginHost()
    def create(context):
        context.on_cleanup(lambda: events.append("first"))
        def fail():
            events.append("second")
            raise RuntimeError("close failure")
        context.on_cleanup(fail)
        return {"ports": {"odk:futu/provider/v1": object()}}
    host.register(definition("provider", create))
    host.start(); host.stop(); host.stop()
    assert events == ["second", "first", "second"]
    assert host.catalog()[0]["state"] == "cleanup-failed"


def test_grants_and_ports_require_declarations():
    host = PluginHost(capabilities={"clock": lambda: 1})
    host.register(definition("provider", lambda context: {"ports": {"odk:futu/provider/v1": context.capability("clock")}}))
    host.start()
    assert host.catalog()[0]["state"] == "failed"
    assert "undeclared capability" in host.catalog()[0]["error"]


def test_disable_releases_consumers_and_enable_restarts_them():
    events = []
    host = PluginHost()
    def create(name):
        def factory(context):
            context.on_cleanup(lambda: events.append(name))
            return {"ports": {"odk:futu/" + name + "/v1": object()}}
        return factory
    host.register(definition("provider", create("provider")))
    host.register(definition("consumer", create("consumer"), ["odk:futu/provider/v1"]))
    host.start(); host.set_enabled("odk.futu.provider", False)
    assert events == ["consumer", "provider"]
    assert [entry["state"] for entry in host.catalog()] == ["disabled", "blocked"]
    host.set_enabled("odk.futu.provider", True)
    assert all(entry["state"] == "running" for entry in host.catalog())
    host.stop()


@pytest.mark.parametrize("fault", ["duplicate", "cycle"])
def test_graph_rejects_duplicate_ports_and_cycles_before_factories(fault):
    host = PluginHost()
    first = definition("first", lambda context: pytest.fail("factory started"))
    second = definition("second", lambda context: pytest.fail("factory started"))
    if fault == "duplicate":
        second["manifest"]["provides"] = first["manifest"]["provides"]
    else:
        first["manifest"]["requires"] = [{"interface": "odk:futu/second/v1"}]
        second["manifest"]["requires"] = [{"interface": "odk:futu/first/v1"}]
    host.register(first); host.register(second)
    with pytest.raises(ValueError, match="duplicate port|dependency cycle"): host.start()


def test_optional_dependency_restarts_and_factory_can_be_replaced_when_stopped():
    observed = []
    host = PluginHost()
    host.register(definition("provider", lambda context: {"ports": {"odk:futu/provider/v1": "first"}}))
    consumer = definition("consumer", lambda context: observed.append(context.get("odk:futu/provider/v1")) or {"ports": {"odk:futu/consumer/v1": object()}})
    consumer["manifest"]["requires"] = [{"interface": "odk:futu/provider/v1", "optional": True}]
    host.register(consumer)
    host.start(); host.set_enabled("odk.futu.provider", False); host.set_enabled("odk.futu.provider", True)
    assert observed == ["first", None, "first"]
    host.stop(); host.start(); host.stop()
    assert observed[-1] == "first"


@pytest.mark.parametrize("provided", [{}, {"odk:futu/provider/v1": None}, {"odk:futu/provider/v1": 1, "odk:futu/extra/v1": 2}])
def test_missing_null_or_undeclared_outputs_release_factory(provided):
    events = []
    host = PluginHost()
    def create(context):
        context.on_cleanup(lambda: events.append("close"))
        return {"ports": provided}
    host.register(definition("provider", create))
    host.start(); host.stop()
    assert host.catalog()[0]["state"] == "failed"
    assert events == ["close"]


def test_interrupted_factory_releases_partial_resources_and_previous_plugins():
    events = []
    host = PluginHost()
    def first(context):
        context.on_cleanup(lambda: events.append("first.close"))
        return {"ports": {"odk:futu/first/v1": object()}}
    def second(context):
        context.on_cleanup(lambda: events.append("second.close"))
        raise KeyboardInterrupt
    host.register(definition("first", first)); host.register(definition("second", second))
    with pytest.raises(KeyboardInterrupt): host.start()
    host.stop()
    assert events == ["second.close", "first.close"]


def test_stop_rejects_cleanup_reentry_without_restarting_released_plugins():
    events = []
    host = PluginHost()
    def first(context):
        context.on_cleanup(lambda: host.set_enabled("odk.futu.second", True))
        return {"ports": {"odk:futu/first/v1": object()}}
    def second(context):
        events.append("second.create")
        context.on_cleanup(lambda: events.append("second.close"))
        return {"ports": {"odk:futu/second/v1": object()}}
    host.register(definition("first", first)); host.register(definition("second", second))
    host.start(); host.set_enabled("odk.futu.second", False); host.stop()
    assert events == ["second.create", "second.close"]
    assert host.get("odk:futu/second/v1") is None
    assert all(entry["state"] != "running" for entry in host.catalog())


def test_stop_failure_blocks_destroy_and_preserves_retry_ownership():
    events = []
    fail = True
    host = PluginHost()
    def create(context):
        context.on_cleanup(lambda: events.append("cleanup"))
        def stop():
            events.append("stop")
            if fail:
                raise RuntimeError("busy")
        return {"ports": {"odk:futu/provider/v1": object()}, "stop": stop, "destroy": lambda: events.append("destroy")}
    host.register(definition("provider", create))
    host.register(definition("independent", lambda context: {"ports": {"odk:futu/independent/v1": object()}, "stop": lambda: events.append("independent")}))
    host.start(); host.stop()
    assert events == ["independent", "stop"]
    assert host.catalog()[0]["state"] == "cleanup-failed"
    with pytest.raises(RuntimeError, match="resources"): host.start()
    with pytest.raises(RuntimeError, match="resources|running"): host.register(definition("late", create))
    fail = False
    host.stop(); host.stop()
    assert events == ["independent", "stop", "stop", "destroy", "cleanup"]


def test_consumer_cleanup_retains_provider_and_retries_only_failed_callback():
    events = []
    source = object()
    fail = True
    contexts = []
    host = PluginHost()
    host.register(definition("provider", lambda context: {"ports": {"odk:futu/provider/v1": source}, "stop": lambda: events.append("provider")}))
    def create(context):
        contexts.append(context)
        context.on_cleanup(lambda: events.append("successful"))
        def cleanup():
            assert context.get("odk:futu/provider/v1") is source
            events.append("retryable")
            if fail:
                raise RuntimeError("resource busy")
        context.on_cleanup(cleanup)
        return {"ports": {"odk:futu/consumer/v1": object()}, "stop": lambda: events.append("stop"), "destroy": lambda: events.append("destroy")}
    host.register(definition("consumer", create, ["odk:futu/provider/v1"]))
    host.start(); host.stop()
    assert events == ["stop", "destroy", "retryable", "successful"]
    assert host.get("odk:futu/provider/v1") is None
    assert contexts[0].get("odk:futu/provider/v1") is None
    assert [entry["state"] for entry in host.catalog()] == ["cleanup-blocked", "cleanup-failed"]
    fail = False
    host.stop(); host.stop()
    assert events == ["stop", "destroy", "retryable", "successful", "retryable", "provider"]


def test_same_value_enable_retries_transient_factory_failure():
    attempts = []
    host = PluginHost()
    def create(context):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("transient")
        return {"ports": {"odk:futu/provider/v1": object()}}
    host.register(definition("provider", create))
    host.start(); host.set_enabled("odk.futu.provider", True)
    assert len(attempts) == 2
    assert host.catalog()[0]["state"] == "running"
    host.stop()


def test_destroy_retry_skips_stop_and_keeps_unrelated_plugin_instance():
    events = []
    creations = []
    fail = True
    host = PluginHost()
    def create(context):
        def destroy():
            events.append("destroy")
            if fail:
                raise RuntimeError("busy")
        return {"ports": {"odk:futu/provider/v1": object()}, "stop": lambda: events.append("stop"), "destroy": destroy}
    host.register(definition("provider", create))
    host.register(definition("independent", lambda context: creations.append(1) or {"ports": {"odk:futu/independent/v1": object()}}))
    host.start(); host.set_enabled("odk.futu.provider", False)
    host.set_enabled("odk.futu.independent", True)
    assert len(creations) == 1
    fail = False
    host.set_enabled("odk.futu.provider", False)
    assert events == ["stop", "destroy", "destroy"]
    host.stop()


@pytest.mark.parametrize("field,value", [("schemaVersion", True), ("version", "١.٠.٠")])
def test_manifest_rejects_field_values_that_the_shared_shell_contract_rejects(field, value):
    called = []
    plugin = definition("provider", lambda context: called.append("create"))
    plugin["manifest"][field] = value
    with pytest.raises(ValueError):
        PluginHost().register(plugin)
    assert called == []
