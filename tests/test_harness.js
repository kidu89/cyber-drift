'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Creates an in-memory mock localStorage implementation.
 */
function createMockStorage() {
    let store = new Map();
    return {
        getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, val) => store.set(String(key), String(val)),
        removeItem: (key) => store.delete(String(key)),
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (idx) => Array.from(store.keys())[idx] || null,
        _dump: () => Object.fromEntries(store.entries())
    };
}

/**
 * Creates a lightweight DOM node mock for headless element testing.
 */
function createMockElement(tagName = 'div', attributes = {}) {
    const classList = new Set();
    const children = [];
    const eventListeners = new Map();
    const style = {};
    const dataset = {};
    const attrs = new Map();

    const el = {
        tagName: tagName.toUpperCase(),
        classList: {
            add: (...cls) => cls.forEach(c => classList.add(c)),
            remove: (...cls) => cls.forEach(c => classList.delete(c)),
            contains: (c) => classList.has(c),
            toggle: (c, force) => {
                if (force !== undefined) {
                    if (force) classList.add(c); else classList.delete(c);
                    return force;
                }
                if (classList.has(c)) { classList.delete(c); return false; }
                classList.add(c);
                return true;
            },
            toString: () => Array.from(classList).join(' ')
        },
        style,
        dataset,
        children,
        parentElement: null,
        id: '',
        textContent: '',
        innerHTML: '',
        setAttribute(name, val) {
            attrs.set(name, String(val));
            if (name.startsWith('data-')) {
                const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                dataset[key] = String(val);
            }
            if (name === 'class') {
                classList.clear();
                String(val).split(/\s+/).filter(Boolean).forEach(c => classList.add(c));
            }
            if (name === 'id') {
                el.id = String(val);
            }
        },
        getAttribute(name) {
            return attrs.get(name) || null;
        },
        hasAttribute(name) {
            return attrs.has(name);
        },
        removeAttribute(name) {
            attrs.delete(name);
        },
        appendChild(child) {
            child.parentElement = el;
            children.push(child);
            return child;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx !== -1) {
                children.splice(idx, 1);
                child.parentElement = null;
            }
            return child;
        },
        addEventListener(event, fn) {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(fn);
        },
        removeEventListener(event, fn) {
            if (!eventListeners.has(event)) return;
            const arr = eventListeners.get(event).filter(f => f !== fn);
            eventListeners.set(event, arr);
        },
        dispatchEvent(evt) {
            const fns = eventListeners.get(evt.type) || [];
            fns.forEach(fn => fn.call(el, evt));
            return true;
        },
        click() {
            el.dispatchEvent({ type: 'click', target: el, preventDefault: () => {}, stopPropagation: () => {} });
        },
        querySelector(selector) {
            const all = el.querySelectorAll(selector);
            return all.length > 0 ? all[0] : null;
        },
        querySelectorAll(selector) {
            const results = [];
            function traverse(node) {
                if (matchesSelector(node, selector)) {
                    results.push(node);
                }
                for (const child of node.children) {
                    traverse(child);
                }
            }
            traverse(el);
            return results;
        }
    };

    for (const [k, v] of Object.entries(attributes)) {
        el.setAttribute(k, v);
    }
    return el;
}

function matchesSelector(el, selector) {
    if (!selector) return false;
    selector = selector.trim();
    if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
    }
    if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
    }
    if (selector.startsWith('[') && selector.endsWith(']')) {
        const inside = selector.slice(1, -1);
        if (inside.includes('=')) {
            const [attr, val] = inside.split('=').map(s => s.trim().replace(/['"]/g, ''));
            return el.getAttribute(attr) === val;
        }
        return el.hasAttribute(inside);
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
}

/**
 * Creates a mock window sandbox populated with __sf engine facades.
 */
function createMockWindow(customOverrides = {}) {
    const storage = createMockStorage();
    const documentBody = createMockElement('body');
    const rootDoc = createMockElement('html');
    rootDoc.appendChild(documentBody);

    const mockDocument = {
        body: documentBody,
        documentElement: rootDoc,
        createElement: (tag) => createMockElement(tag),
        getElementById: (id) => {
            function find(node) {
                if (node.id === id) return node;
                for (const child of node.children) {
                    const res = find(child);
                    if (res) return res;
                }
                return null;
            }
            return find(rootDoc);
        },
        querySelector: (sel) => rootDoc.querySelector(sel),
        querySelectorAll: (sel) => rootDoc.querySelectorAll(sel),
        addEventListener: () => {},
        removeEventListener: () => {}
    };

    // Populate mock pause menu elements for M5 integration testing
    const pauseMenu = createMockElement('div', { class: 'ov', id: 'pause' });
    const setSide = createMockElement('nav', { id: 'setSide', role: 'tablist' });
    const setPane = createMockElement('div', { id: 'setPane' });
    pauseMenu.appendChild(setSide);
    pauseMenu.appendChild(setPane);
    documentBody.appendChild(pauseMenu);

    const mockWindow = {
        localStorage: storage,
        document: mockDocument,
        location: { href: 'http://localhost:3000/', pathname: '/', origin: 'http://localhost:3000' },
        performance: { now: () => Date.now() },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        CustomEvent: function(type, params = {}) {
            return { type, detail: params.detail || {} };
        },
        __sf: {
            v: {
                speed: 0,
                speedKmh: 0,
                slipAngle: 0,
                nitro: 100,
                latG: 0,
                throttle: 0,
                brake: 0,
                handbrake: false
            },
            car: {
                materials: {
                    Body: { color: { r: 1, g: 1, b: 1, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } } }
                },
                model: {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    add: () => {},
                    remove: () => {}
                }
            },
            carId: 'waymo',
            hs: {
                waymo: { name: 'Waymo Jaguar I-PACE', mass: 2200, topSpeed: 160 },
                supercar: { name: 'Apex GT Supercar', mass: 1450, topSpeed: 330 }
            },
            e2: ['waymo', 'supercar'],
            kp: {
                gloss: { roughness: 0.1, metalness: 0.2 },
                matte: { roughness: 0.7, metalness: 0.0 }
            },
            swapCar(id) {
                if (this.hs[id]) {
                    this.carId = id;
                    return true;
                }
                return false;
            },
            tele(x, z) {
                this.car.model.position.x = x;
                this.car.model.position.z = z;
                return true;
            },
            ...customOverrides
        }
    };

    return mockWindow;
}

/**
 * Loads a JavaScript file in a sandboxed VM context.
 */
function loadSandboxedScript(filePath, sandboxWindow) {
    if (!fs.existsSync(filePath)) {
        return { loaded: false, error: 'File does not exist' };
    }
    const code = fs.readFileSync(filePath, 'utf8');
    const context = vm.createContext({
        window: sandboxWindow,
        document: sandboxWindow.document,
        localStorage: sandboxWindow.localStorage,
        location: sandboxWindow.location,
        console: sandboxWindow.console,
        performance: sandboxWindow.performance,
        setTimeout: sandboxWindow.setTimeout,
        clearTimeout: sandboxWindow.clearTimeout,
        setInterval: sandboxWindow.setInterval,
        clearInterval: sandboxWindow.clearInterval,
        globalThis: sandboxWindow,
        self: sandboxWindow
    });

    try {
        vm.runInContext(code, context, { filename: path.basename(filePath) });
        return { loaded: true, window: sandboxWindow };
    } catch (err) {
        return { loaded: false, error: err };
    }
}

/**
 * Makes an HTTP request and returns status, headers, and body.
 */
function request(options, body = null) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            ...options,
            agent: false,
            headers: {
                Connection: 'close',
                ...(options.headers || {})
            }
        };
        const req = http.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const rawBody = Buffer.concat(chunks);
                res.destroy();
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    rawBody,
                    body: rawBody.toString('utf8')
                });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

module.exports = {
    PROJECT_ROOT,
    createMockStorage,
    createMockElement,
    createMockWindow,
    loadSandboxedScript,
    request
};
