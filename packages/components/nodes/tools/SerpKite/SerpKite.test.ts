import { TOOL_ARGS_PREFIX } from '../../../src/agents'
import { SERPKITE_OPERATIONS, createSerpKiteTools } from './core'

const mockFetch = jest.fn()
global.fetch = mockFetch as any

const respond = (status: number, body: string) =>
    mockFetch.mockResolvedValueOnce({ ok: status < 400, status, text: async () => body } as any)

const lastRequest = () => {
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, any]
    return { url, init, body: JSON.parse(init.body) }
}

const tool = (name: string, defaultParams = {}) =>
    createSerpKiteTools({ apiKey: 'skt_live_test', operations: [name], defaultParams })[0] as any

describe('SerpKite tools', () => {
    beforeEach(() => mockFetch.mockReset())

    it('creates only the selected tools, with unique names', () => {
        const tools = createSerpKiteTools({ apiKey: 'k', operations: ['search', 'chatgpt', 'unknown'] })
        expect(tools.map((t) => t.name)).toEqual(['serpkite_search', 'serpkite_chatgpt'])
        const all = createSerpKiteTools({ apiKey: 'k', operations: SERPKITE_OPERATIONS.map((op) => op.name) })
        expect(new Set(all.map((t) => t.name)).size).toBe(SERPKITE_OPERATIONS.length)
    })

    it('waits long enough for AI answers', () => {
        for (const name of ['answer', 'extract', 'chatgpt', 'gemini', 'copilot', 'ai_mode', 'brave_ai']) {
            expect(SERPKITE_OPERATIONS.find((op) => op.name === name)?.timeoutMs).toBeGreaterThanOrEqual(120000)
        }
    })

    it('posts search with Bearer auth, markdown format and node defaults', async () => {
        respond(200, '# Results')
        const out = await tool('search', { country: 'de', language: 'de' })._call({ q: 'coffee', country: 'at' })
        const { url, init, body } = lastRequest()
        expect(url).toBe('https://api.serpkite.com/v1/search')
        expect(init.headers.Authorization).toBe('Bearer skt_live_test')
        expect(body).toEqual({ q: 'coffee', country: 'at', language: 'de', format: 'markdown' })
        expect(out.split(TOOL_ARGS_PREFIX)[0]).toBe('# Results')
    })

    it('sends only fields the operation accepts', async () => {
        respond(200, 'answer')
        await tool('chatgpt', { country: 'us', language: 'en' })._call({ prompt: 'best crm' })
        expect(lastRequest().body).toEqual({ prompt: 'best crm', country: 'us', format: 'markdown' })
        expect(lastRequest().init.signal).toBeInstanceOf(AbortSignal)

        respond(200, 'page')
        await tool('webpage', { country: 'us' })._call({ url: 'https://example.com' })
        expect(lastRequest().body).toEqual({ url: 'https://example.com', format: 'markdown' })
    })

    it('renders answer JSON as Markdown with sources', async () => {
        respond(
            200,
            JSON.stringify({ answer: 'RAG grounds answers [1].', citations: [{ index: 1, title: 'RAG', link: 'https://example.com/rag' }] })
        )
        const out = await tool('answer')._call({ q: 'what is rag' })
        expect(lastRequest().body.format).toBeUndefined()
        expect(out.split(TOOL_ARGS_PREFIX)[0]).toBe('RAG grounds answers [1].\n\nSources:\n[1] RAG — https://example.com/rag\n')
    })

    it('renders extract results, highlights and failures', async () => {
        respond(
            200,
            JSON.stringify({
                results: [
                    { title: 'Pricing', url: 'https://example.com/pricing', summary: 'Plans.', highlights: [{ text: 'Pro is $10' }] }
                ],
                failed: [{ url: 'https://example.com/x', error: { message: 'not found' } }]
            })
        )
        const out = await tool('extract')._call({ urls: ['https://example.com/pricing'], query: 'price', highlights: 1 })
        expect(out).toContain('# Pricing\nhttps://example.com/pricing')
        expect(out).toContain('Summary: Plans.')
        expect(out).toContain('> Pro is $10')
        expect(out).toContain('_Could not read https://example.com/x: not found_')
    })

    it('returns API errors to the agent, with the retry hint for late answers', async () => {
        respond(401, JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid API key', request_id: 'r' } }))
        expect(await tool('search')._call({ q: 'x' })).toContain('SerpKite error 401 unauthorized: Invalid API key')

        respond(503, JSON.stringify({ error: { code: 'upstream_timeout', message: 'Still answering', request_id: 'r' } }))
        expect(await tool('gemini')._call({ prompt: 'x' })).toContain('within 10 minutes')

        respond(503, JSON.stringify({ error: { code: 'upstream_timeout', message: 'Timed out', request_id: 'r' } }))
        expect(await tool('brave_ai')._call({ prompt: 'x' })).not.toContain('within 10 minutes')
    })

    it('requires place_id or cid for place', async () => {
        expect(await tool('place')._call({ country: 'us' })).toContain('place_id or cid is required')
        expect(mockFetch).not.toHaveBeenCalled()
    })
})
