from aiohttp import web


class StatusHttpServer:
    def __init__(self, port, state):
        self.port = port
        self.state = state
        self.app = web.Application()
        self.app.router.add_get("/status", self.handle_status)
        self.runner = None

    async def handle_status(self, request):
        return web.json_response(self.state.status_payload())

    async def start(self):
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", self.port)
        await site.start()

    async def stop(self):
        if self.runner:
            await self.runner.cleanup()
