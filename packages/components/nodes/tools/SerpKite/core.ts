import { z } from 'zod/v3'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'

export const SERPKITE_API_BASE = 'https://api.serpkite.com'

const SEARCH_TIMEOUT_MS = 60_000
// AI answers take up to 90 s on the API side
const AI_TIMEOUT_MS = 120_000

const q = z.string().describe('Search query')
const country = z.string().optional().describe('Country code, e.g. us, de, gb')
const language = z.string().optional().describe('Language code, e.g. en, de')
const location = z.string().optional().describe('City-level location, e.g. "Austin, Texas, United States"')
const page = z.number().int().min(1).max(10).optional().describe('Results page, 1-10')
const time = z
    .enum(['hour', 'day', 'week', 'month', 'year'])
    .optional()
    .describe('Only results from the last hour, day, week, month or year')
const domains = (desc: string) =>
    z.array(z.string()).max(20).optional().describe(`${desc}: a domain (example.com), a path prefix (github.com/org) or a TLD (.gov)`)
const prompt = z.string().max(4000).describe('The message to the assistant (up to 4,000 characters)')
const track = z
    .array(z.string())
    .max(20)
    .optional()
    .describe('Brands or domains to check the answer for: the result lists whether each is named, cited or shown as a product')
const assistantSchema = z.object({
    prompt,
    country: z.string().optional().describe('Ask from this country, e.g. us, de, gb (answers, prices and shops follow it)'),
    language,
    track
})

type Render = (body: any) => string

export interface SerpKiteOperation {
    /** Option name in the node and suffix of the tool name */
    name: string
    label: string
    path: string
    description: string
    schema: z.ZodObject<any>
    timeoutMs: number
    /** Endpoints without format=markdown return JSON that is rendered to Markdown here */
    render?: Render
    /** The API may finish a slow answer after the request ends and return it to a retry */
    lateAnswers?: boolean
}

const renderAnswer: Render = (body) => {
    let out = body.answer ? `${body.answer}\n\n` : '_No answer: the search found nothing to answer from._\n'
    const citations: any[] = body.citations ?? []
    if (citations.length) {
        out += 'Sources:\n' + citations.map((c) => `[${c.index}] ${c.title ?? ''} — ${c.link ?? ''}`).join('\n') + '\n'
    }
    return out
}

const renderExtract: Render = (body) => {
    let out = ''
    for (const r of body.results ?? []) {
        out += `# ${r.title ?? ''}\n${r.url ?? ''}\n\n`
        if (r.summary) out += `Summary: ${r.summary}\n\n`
        if (r.highlights?.length) {
            out += r.highlights.map((h: any) => `> ${String(h.text ?? '').replace(/\n/g, '\n> ')}`).join('\n\n') + '\n\n'
        } else {
            out += `${r.markdown ?? r.text ?? ''}\n\n`
        }
    }
    for (const f of body.failed ?? []) {
        out += `_Could not read ${f.url}: ${f.error?.message ?? 'failed'}_\n`
    }
    return out
}

const assistant = (name: string, label: string, path: string, description: string, lateAnswers = false): SerpKiteOperation => ({
    name,
    label,
    path,
    description,
    schema: assistantSchema,
    timeoutMs: AI_TIMEOUT_MS,
    lateAnswers
})

export const SERPKITE_OPERATIONS: SerpKiteOperation[] = [
    {
        name: 'search',
        label: 'Google Search',
        path: '/v1/search',
        description:
            'Search Google. Returns organic results, answer box, knowledge graph, People also ask and related searches as Markdown. Use for current information and facts.',
        schema: z.object({
            q,
            country,
            language,
            location,
            page,
            time,
            include_domains: domains('Only results from these sources'),
            exclude_domains: domains('Drop results from these sources')
        }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'news',
        label: 'Google News',
        path: '/v1/news',
        description: 'Search Google News for recent articles with source and date.',
        schema: z.object({ q, country, language, page, time }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'images',
        label: 'Google Images',
        path: '/v1/images',
        description: 'Search Google Images: image URL, size, title and source page.',
        schema: z.object({ q, country, language, page, time }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'videos',
        label: 'Google Videos',
        path: '/v1/videos',
        description: 'Search videos: title, link, channel, duration and date.',
        schema: z.object({ q, country, language, page, time }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'maps',
        label: 'Google Maps',
        path: '/v1/maps',
        description:
            'Find places: name, rating, category, address, phone, website and place_id. Put the area in location (e.g. "Berlin, Germany") or in q. The place tool returns one place\'s hours and full listing.',
        schema: z.object({ q, location, country, language, page }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'place',
        label: 'Google Maps Place',
        path: '/v1/place',
        description:
            'The full listing of one place by its place_id (or cid) from a maps result: address, coordinates, categories, opening hours, website, phone, rating and description.',
        schema: z.object({
            place_id: z.string().optional().describe('Google place id ("ChIJ…") from a maps result'),
            cid: z.string().optional().describe('Decimal customer id from a maps result (instead of place_id)'),
            country,
            language
        }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'shopping',
        label: 'Google Shopping',
        path: '/v1/shopping',
        description: 'Search products with prices and merchants.',
        schema: z.object({ q, country, language, location, page }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'scholar',
        label: 'Google Scholar',
        path: '/v1/scholar',
        description: 'Search academic papers with authors, citations and PDF links.',
        schema: z.object({ q, country, language, page }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'patents',
        label: 'Google Patents',
        path: '/v1/patents',
        description: 'Search patents: title, number, assignee, dates and PDF links.',
        schema: z.object({ q, country, language, page }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'webpage',
        label: 'Fetch Webpage',
        path: '/v1/webpage',
        description: 'Fetch a public URL (HTML or PDF) and return its main content as clean Markdown with metadata.',
        schema: z.object({
            url: z.string().describe('The page or PDF URL'),
            country: z.string().optional().describe('Fetch from this country, e.g. de (for geo-dependent pages)')
        }),
        timeoutMs: SEARCH_TIMEOUT_MS
    },
    {
        name: 'extract',
        label: 'Extract Pages',
        path: '/v1/extract',
        description:
            'Read up to 20 URLs (HTML or PDF) as Markdown. With query and highlights, return only the passages most relevant to the query; with summary, a short summary of each page.',
        schema: z.object({
            urls: z.array(z.string()).min(1).max(20).describe('Page or PDF URLs'),
            query: z.string().optional().describe('What to rank passages against (with highlights)'),
            highlights: z.number().int().min(0).max(10).optional().describe('Passages per page ranked against query (0 = full page)'),
            summary: z.boolean().optional().describe('Add a 3-6 sentence AI summary of each page'),
            max_tokens: z.number().int().min(100).max(100000).optional().describe('Cap per page, in tokens')
        }),
        timeoutMs: AI_TIMEOUT_MS,
        render: renderExtract
    },
    {
        name: 'answer',
        label: 'Answer with Citations',
        path: '/v1/answer',
        description:
            'Answer a question from live Google results with numbered citations. depth=fast answers from the result page; standard (default) also reads the top pages.',
        schema: z.object({
            q: z.string().describe('The question'),
            depth: z.enum(['fast', 'standard']).optional().describe('fast or standard (default)'),
            num_sources: z.number().int().min(1).max(5).optional().describe('Pages to read with depth=standard (default 3)'),
            country,
            language,
            time
        }),
        timeoutMs: AI_TIMEOUT_MS,
        render: renderAnswer
    },
    {
        name: 'chatgpt',
        label: 'Ask ChatGPT',
        path: '/v1/chatgpt',
        description:
            'Ask ChatGPT (chatgpt.com, as a logged-out user, searching the web) and get its answer as Markdown with the sources it cited and the products and places it showed. Use it to see what ChatGPT tells people. Takes 10-30 s.',
        schema: z.object({
            prompt,
            country: z.string().optional().describe('Ask as a visitor in this country, e.g. us, de, gb'),
            web_search: z.boolean().optional().describe('Make ChatGPT search the web (default true); false lets it decide'),
            track
        }),
        timeoutMs: AI_TIMEOUT_MS,
        lateAnswers: true
    },
    assistant(
        'gemini',
        'Ask Gemini',
        '/v1/gemini',
        'Ask Google Gemini (gemini.google.com, as a logged-out user) and get its answer with the sources it grounded on. Takes 5-30 s.',
        true
    ),
    assistant(
        'copilot',
        'Ask Copilot Search',
        '/v1/copilot',
        'Ask Microsoft Copilot Search on Bing and get its answer with cited sources and products. Takes 15-40 s.'
    ),
    assistant(
        'ai_mode',
        'Ask Google AI Mode',
        '/v1/ai_mode',
        "Ask Google AI Mode, Google's conversational search, and get its answer with cited sources and products. Takes 5-45 s."
    ),
    assistant(
        'brave_ai',
        'Ask Brave AI',
        '/v1/brave_ai',
        "Ask Brave Search's AI answer and get it with cited sources, the searches it ran and products. Takes 1-10 s."
    )
]

export interface SerpKiteToolArgs {
    apiKey: string
    operations: string[]
    defaultParams?: { country?: string; language?: string }
    baseUrl?: string
}

export class SerpKiteTool extends DynamicStructuredTool {
    private apiKey: string
    private operation: SerpKiteOperation
    private defaultParams: { country?: string; language?: string }
    private apiBase: string

    constructor(operation: SerpKiteOperation, args: SerpKiteToolArgs) {
        super({
            name: `serpkite_${operation.name}`,
            description: operation.description,
            schema: operation.schema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        })
        this.operation = operation
        this.apiKey = args.apiKey
        this.defaultParams = args.defaultParams ?? {}
        this.apiBase = args.baseUrl ?? SERPKITE_API_BASE
    }

    /** The request body: the tool arguments, node defaults for fields the operation takes, and format=markdown where supported */
    buildBody(arg: Record<string, any>): Record<string, any> {
        const shape = this.operation.schema.shape
        const body: Record<string, any> = {}
        // webpage's country picks where the page is fetched from, so it only follows the tool argument
        if (this.operation.name !== 'webpage') {
            for (const [key, value] of Object.entries(this.defaultParams)) {
                if (value && key in shape) body[key] = value
            }
        }
        for (const [key, value] of Object.entries(arg ?? {})) {
            if (value !== undefined && value !== null && value !== '') body[key] = value
        }
        if (!this.operation.render) body.format = 'markdown'
        return body
    }

    // @ts-ignore
    protected async _call(arg: any): Promise<string> {
        const body = this.buildBody(arg)
        if (this.operation.name === 'place' && !body.place_id && !body.cid) {
            return formatToolError('SerpKite error: place_id or cid is required', arg)
        }
        try {
            // The URL is always the SerpKite API (never user input), so plain fetch with a timeout is enough
            const response = await fetch(`${this.apiBase}${this.operation.path}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'flowise-serpkite'
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.operation.timeoutMs)
            })
            const text = await response.text()
            if (!response.ok) {
                return formatToolError(this.errorMessage(response.status, text), arg)
            }
            const output = this.operation.render ? this.operation.render(JSON.parse(text)) : text
            return output + TOOL_ARGS_PREFIX + JSON.stringify(arg)
        } catch (error) {
            return formatToolError(`SerpKite request failed: ${error}`, arg)
        }
    }

    errorMessage(status: number, text: string): string {
        let code = ''
        let message = text.slice(0, 500)
        try {
            const parsed = JSON.parse(text)
            code = parsed?.error?.code ?? ''
            message = parsed?.error?.message ?? message
        } catch {
            // not JSON: keep the trimmed body
        }
        let out = `SerpKite error ${status}${code ? ` ${code}` : ''}: ${message}`
        if (code === 'upstream_timeout' && this.operation.lateAnswers) {
            out +=
                ' If the answer is being finished in the background, call this tool again with the same arguments within 10 minutes to receive it.'
        }
        return out
    }
}

export const createSerpKiteTools = (args: SerpKiteToolArgs): SerpKiteTool[] =>
    SERPKITE_OPERATIONS.filter((op) => args.operations.includes(op.name)).map((op) => new SerpKiteTool(op, args))
