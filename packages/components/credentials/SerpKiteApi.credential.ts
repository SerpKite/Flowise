import { INodeParams, INodeCredential } from '../src/Interface'

class SerpKiteApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'SerpKite API'
        this.name = 'serpKiteApi'
        this.version = 1.0
        this.description =
            'Get your API key from the <a target="_blank" href="https://app.serpkite.com/keys">SerpKite dashboard</a>. It starts with skt_live_'
        this.inputs = [
            {
                label: 'SerpKite Api Key',
                name: 'serpKiteApiKey',
                type: 'password'
            }
        ]
    }
}

module.exports = { credClass: SerpKiteApi }
