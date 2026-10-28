import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam } from '../../../src/utils'
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { SERPKITE_OPERATIONS, createSerpKiteTools } from './core'

class SerpKite_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'SerpKite'
        this.name = 'serpKite'
        this.version = 1.0
        this.type = 'SerpKite'
        this.icon = 'serpkite.svg'
        this.category = 'Tools'
        this.description =
            'Real-time Google Search, News, Maps, Shopping, Scholar and webpages as Markdown, cited answers, and what ChatGPT, Gemini, Copilot Search, Google AI Mode and Brave AI answer'
        this.baseClasses = [this.type, 'Tool']
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['serpKiteApi']
        }
        this.inputs = [
            {
                label: 'Tools',
                name: 'serpKiteTools',
                type: 'multiOptions',
                description:
                    'Tools the agent can call. Each call is billed per the <a target="_blank" href="https://serpkite.com/pricing">SerpKite pricing</a>; failed and empty requests are not billed',
                options: SERPKITE_OPERATIONS.map((op) => ({ label: op.label, name: op.name, description: op.description })),
                default: JSON.stringify(['search', 'webpage'])
            },
            {
                label: 'Default Country',
                name: 'country',
                type: 'string',
                description: 'Country code used when the agent does not pass one, e.g. us, de, gb',
                placeholder: 'us',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Default Language',
                name: 'language',
                type: 'string',
                description: 'Language code used when the agent does not pass one, e.g. en, de',
                placeholder: 'en',
                additionalParams: true,
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const apiKey = getCredentialParam('serpKiteApiKey', credentialData, nodeData)
        if (!apiKey) {
            throw new Error('SerpKite API key is required')
        }

        const selected = nodeData.inputs?.serpKiteTools
        const operations: string[] = Array.isArray(selected) ? selected : convertMultiOptionsToStringArray(selected)
        if (!operations.length) {
            throw new Error('Select at least one SerpKite tool')
        }

        const country = (nodeData.inputs?.country as string)?.trim()
        const language = (nodeData.inputs?.language as string)?.trim()

        return createSerpKiteTools({ apiKey, operations, defaultParams: { country, language } })
    }
}

module.exports = { nodeClass: SerpKite_Tools }
