/**
 * @typedef Bindings
 * @property {DurableObjectNamespace} COUNTER
 */

const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>do-sse-test</title>
    <script>
    const eventsource = new EventSource('/sse', {
        withCredentials: true, // This is required for cookies
      })
       
      eventsource.onmessage = (event) => {
        const data = JSON.parse(event.data)
        console.log(data)
        document.getElementById("current").innerHTML = data
      }
      eventsource.onerror = (err) => {
        console.log('ev error:', err)
        eventsource.close()
      }
      function inc() {
        fetch('/increment')
      }
      function dec() {
        fetch('/decrement')
      }
    </script>
  </head>
  <body>
  <input id="inc" type="button" value="inc" onclick="inc();" />
  <input id="dec" type="button" value="dec" onclick="dec();" />
  <p>Current: <div id="current" /></p>
  </body>
</html>
`

/**
 * Worker
 */
export default {
    /**
     * @param {Request} req
     * @param {Bindings} env
     * @returns {Promise<Response>}
     */
    async fetch(req, env) {
        const url = new URL(req.url)
        switch (url.pathname) {
            case '/':
                return new Response(html, {
                    headers: {"Content-Type": "text/html"},
                    status: 200
                })
            default:
                let id = env.COUNTER.idFromName('A');
                let obj = env.COUNTER.get(id);
                return obj.fetch(req);
        }

    },
};
const textEncoder = new TextEncoder()

/**
 * Durable Object
 */
export class Counter {
    /**
     * @param {DurableObjectState} state
     */
    constructor(state) {
        this.state = state;
        this.consumers = new Map();
    }

    async publish(v) {
        await this.state.storage.put('value', v);
        const chunk = JSON.stringify(v)
        let payload = textEncoder.encode(`data: ${chunk}\n\n`)
        console.log('size', this.consumers.size)
        for (const [id, connection] of this.consumers) {
            try {
                await connection.stream.write(payload)
                console.log('publishing:', v)
            } catch (error) {
                console.log('error writing:', error)
                this.consumers.delete(id)
            }
            
        }
        return new Response('' + v);
    }

    /**
     * Handle HTTP requests from clients.
     * @param {Request} request
     */
    async fetch(request) {
        // Apply requested action.
        let url = new URL(request.url);

        // Durable Object storage is automatically cached in-memory, so reading the same key every request is fast.
        // (That said, you could also store the value in a class member if you prefer.)
        /** @type {number} */
        let value = (await this.state.storage.get('value')) || 0;

        switch (url.pathname) {
            case '/increment':
                return this.publish(++value)
            case '/decrement':
                return this.publish(--value)
            case '/sse':
                let id = crypto.randomUUID();
                console.log('SSE CONNECTED', id)
                let { readable, writable } = new IdentityTransformStream();
                let stream = writable.getWriter()
                let consumers = this.consumers;
                this.consumers.set(id, {stream})
                return new Response(readable, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Connection': 'keep-alive',
                        'Cache-Control': 'no-cache'
                    },
                    status: 200
                })
            default:
                return new Response('Not found', { status: 404 });
        }
    }
}