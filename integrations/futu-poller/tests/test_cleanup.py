"""Publishing cleanup keeps unresolved handles without affecting other desks."""
import pytest
import poller


def test_publisher_retries_failed_links_without_repeating_successful_cleanup():
    calls = []
    fail = True
    class Link:
        def __init__(self, name): self.name = name
        def close(self):
            calls.append(self.name)
            if self.name == "first" and fail: raise OSError("connection busy")
    publisher = poller.LinkSet([Link("first"), Link("second")], "fixture")
    with pytest.raises(OSError, match="connection busy"): publisher.close()
    assert calls == ["first", "second"]
    fail = False
    publisher.close(); publisher.close()
    assert calls == ["first", "second", "first"]


def test_shell_link_retains_uncertain_close_and_never_reuses_the_connection():
    calls = []
    class Connection:
        def close(self):
            calls.append("close")
            raise OSError("release unknown")
        def sendall(self, _data): pytest.fail("reused failed connection")
    target = poller.Target(endpoint="tcp://127.0.0.1:8765", parsed=poller.parse_endpoint("tcp://127.0.0.1:8765"), label="fixture", token_file="unused")
    link = poller.ShellLink(target, "fixture", "r1")
    connection = Connection()
    link.conn = connection
    with pytest.raises(OSError, match="release unknown"): link.close()
    assert link.conn is connection
    with pytest.raises(OSError, match="release unknown"): link.close()
    assert link.ensure() is False
    assert calls == ["close"]
