"""Poller adapters preserve the synchronous host's factory result boundary."""
import asyncio
from concurrent.futures import Future
import inspect

import poller
import pytest


@pytest.mark.parametrize("component", ("publisher", "gateway", "loop", "transport"))
@pytest.mark.parametrize("kind", ("coroutine", "awaitable", "thread-future", "asyncio-future"))
def test_factory_adapter_rejects_async_results_before_port_publication(component, kind):
    events = []
    loop = asyncio.new_event_loop()
    async def unsupported():
        events.append("body")
    class Awaitable:
        def __await__(self): pytest.fail("awaitable executed")
        def close(self): pytest.fail("arbitrary awaitable closed")
        def send(self, _record): pass
        def snapshot(self): return {}
        def run(self): pass
    class ThreadFuture(Future):
        def exception(self, timeout=None):
            events.append("exception consumed")
            return super().exception(timeout)
    class AsyncFuture(asyncio.Future):
        def exception(self):
            events.append("exception consumed")
            return super().exception()
    result = {"coroutine": unsupported, "awaitable": Awaitable,
              "thread-future": ThreadFuture, "asyncio-future": lambda: AsyncFuture(loop=loop)}[kind]()
    if isinstance(result, (Future, asyncio.Future)):
        result.set_exception(RuntimeError("fixture failure"))
    class Publisher:
        def send(self, _record): pass
    class Gateway:
        def snapshot(self): return {}
    def factory(context):
        context.on_cleanup(lambda: events.append("cleanup"))
        return result
    factories = {"publisher_factory": lambda context: Publisher(), "gateway_factory": lambda context: Gateway()}
    factories[component + "_factory"] = factory
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, **factories)
    try:
        with pytest.raises(TypeError, match="must be synchronous"):
            runtime.start()
        assert runtime.host.get(poller.PORTS[component]) is None
        runtime.close()
        assert events.count("cleanup") == 1
        assert "body" not in events
        if kind == "coroutine":
            assert inspect.getcoroutinestate(result) == inspect.CORO_CLOSED
        if isinstance(result, (Future, asyncio.Future)):
            assert events.count("exception consumed") == 1
    finally:
        if inspect.iscoroutine(result): result.close()
        if isinstance(result, (Future, asyncio.Future)) and "exception consumed" not in events:
            result.exception()
        loop.close()


@pytest.mark.parametrize("component", ("publisher", "gateway", "loop", "transport"))
@pytest.mark.parametrize("kind", ("thread", "asyncio"))
def test_adapter_consumes_late_future_failure_without_cancelling_work(component, kind):
    loop = asyncio.new_event_loop()
    events = []
    class ThreadFuture(Future):
        def exception(self, timeout=None):
            events.append("exception consumed")
            return super().exception(timeout)
    class AsyncFuture(asyncio.Future):
        def exception(self):
            events.append("exception consumed")
            return super().exception()
    result = ThreadFuture() if kind == "thread" else AsyncFuture(loop=loop)
    class Publisher:
        def send(self, _record): pass
    class Gateway:
        def snapshot(self): return {}
    def factory(context):
        context.on_cleanup(lambda: events.append("cleanup"))
        return result
    factories = {"publisher_factory": lambda context: Publisher(), "gateway_factory": lambda context: Gateway()}
    factories[component + "_factory"] = factory
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, **factories)
    try:
        with pytest.raises(TypeError, match="must be synchronous"):
            runtime.start()
        assert not result.done()
        assert events == ["cleanup"]
        result.set_exception(RuntimeError("fixture delayed failure"))
        loop.run_until_complete(asyncio.sleep(0))
        assert events == ["cleanup", "exception consumed"]
        assert not result.cancelled()
        runtime.close()
        assert events.count("cleanup") == 1
    finally:
        if result.done() and not result.cancelled() and "exception consumed" not in events:
            result.exception()
        loop.close()
