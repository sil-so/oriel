(function initializeOrielData(global) {
    const nativeHandler = global.webkit?.messageHandlers?.oriel;
    const httpFetch = typeof fetch === 'function' ? fetch.bind(global) : null;

    function jsonResponse(value, status = 200) {
        return {
            ok: status >= 200 && status < 300,
            status,
            async json() { return value; }
        };
    }

    function mapApiRequest(input, options = {}) {
        const url = new URL(input, 'http://localhost:3000');
        const method = String(options.method || 'GET').toUpperCase();
        const path = url.pathname;
        const payload = options.body ? JSON.parse(options.body) : {};
        const params = Object.fromEntries(url.searchParams.entries());

        if (path === '/api/status' && method === 'GET') return ['status.get', {}];
        if (path === '/api/activities' && method === 'GET') return ['activities.list', params];
        if (path === '/api/projects' && method === 'GET') return ['projects.list', {}];
        if (path === '/api/projects' && method === 'POST') return ['projects.create', payload];
        if (path.startsWith('/api/projects/') && method === 'PUT') return ['projects.update', { id: path.split('/').pop(), ...payload }];
        if (path.startsWith('/api/projects/') && method === 'DELETE') return ['projects.delete', { id: path.split('/').pop() }];
        if (path === '/api/time-entries' && method === 'GET') return ['entries.list', params];
        if (path === '/api/time-entries' && method === 'POST') return ['entries.create', payload];
        if (path.startsWith('/api/time-entries/') && method === 'PUT') return ['entries.update', { id: path.split('/').pop(), ...payload }];
        if (path.startsWith('/api/time-entries/') && method === 'DELETE') return ['entries.delete', { id: path.split('/').pop() }];
        if (path === '/api/rules' && method === 'GET') return ['rules.list', {}];
        if (path === '/api/rules' && method === 'POST') return ['rules.create', payload];
        if (path.startsWith('/api/rules/') && method === 'DELETE') return ['rules.delete', { id: path.split('/').pop() }];
        if (path === '/api/exclusions' && method === 'GET') return ['exclusions.list', {}];
        if (path === '/api/exclusions' && method === 'POST') return ['exclusions.create', payload];
        if (path.startsWith('/api/exclusions/') && method === 'DELETE') return ['exclusions.delete', { id: path.split('/').pop() }];
        if (path === '/api/purge' && method === 'POST') return ['data.purge', {}];
        return null;
    }

    const OrielData = {
        isNative: Boolean(nativeHandler),

        async request(operation, payload = {}) {
            if (!nativeHandler) {
                throw new Error('Native Oriel bridge is not available in browser development mode.');
            }
            const reply = await nativeHandler.postMessage({ operation, payload });
            if (!reply || reply.ok !== true) {
                throw new Error(reply?.error?.message || 'Native Oriel request failed.');
            }
            return reply.value;
        },

        async fetch(input, options) {
            if (!nativeHandler) {
                if (!httpFetch) throw new Error('Fetch API is unavailable.');
                return httpFetch(input, options);
            }
            const mapped = mapApiRequest(input, options);
            if (!mapped) return jsonResponse({ error: 'Unsupported native route' }, 404);
            try {
                return jsonResponse(await this.request(mapped[0], mapped[1]));
            } catch (error) {
                return jsonResponse({ error: error.message }, 400);
            }
        }
    };

    global.OrielData = OrielData;
    if (OrielData.isNative) {
        global.document?.documentElement?.classList.add('is-native-shell');
        global.fetch = OrielData.fetch.bind(OrielData);
    }
})(window);
