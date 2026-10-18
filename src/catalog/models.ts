import { vendor, type Q } from './types';

/**
 * Transformer model architectures used by the workload model. Dimensions follow the public
 * model cards; FLOP and memory figures are derived from them in the engine.
 */
export interface ModelArchSpec {
  readonly id: string;
  readonly name: string;
  readonly family: 'dense' | 'moe';
  /** Total parameters (determines memory). */
  readonly params: Q;
  /** Parameters active per token (determines FLOPs). Equal to `params` for dense models. */
  readonly activeParams: Q;
  readonly layers: number;
  readonly hidden: number;
  readonly heads: number;
  readonly kvHeads: number;
  readonly vocab: number;
  readonly maxContext: number;
}

export const MODELS: readonly ModelArchSpec[] = [
  {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    family: 'dense',
    params: vendor(8.03e9),
    activeParams: vendor(8.03e9),
    layers: 32,
    hidden: 4096,
    heads: 32,
    kvHeads: 8,
    vocab: 128_256,
    maxContext: 131_072,
  },
  {
    id: 'llama-3.1-70b',
    name: 'Llama 3.1 70B',
    family: 'dense',
    params: vendor(70.6e9),
    activeParams: vendor(70.6e9),
    layers: 80,
    hidden: 8192,
    heads: 64,
    kvHeads: 8,
    vocab: 128_256,
    maxContext: 131_072,
  },
  {
    id: 'llama-3.1-405b',
    name: 'Llama 3.1 405B',
    family: 'dense',
    params: vendor(405.9e9),
    activeParams: vendor(405.9e9),
    layers: 126,
    hidden: 16_384,
    heads: 128,
    kvHeads: 8,
    vocab: 128_256,
    maxContext: 131_072,
  },
  {
    id: 'gpt3-175b',
    name: 'GPT-3 175B',
    family: 'dense',
    params: vendor(175e9),
    activeParams: vendor(175e9),
    layers: 96,
    hidden: 12_288,
    heads: 96,
    kvHeads: 96,
    vocab: 50_257,
    maxContext: 2048,
  },
  {
    id: 'mixtral-8x22b',
    name: 'Mixtral 8x22B (MoE)',
    family: 'moe',
    params: vendor(141e9),
    activeParams: vendor(39e9),
    layers: 56,
    hidden: 6144,
    heads: 48,
    kvHeads: 8,
    vocab: 32_768,
    maxContext: 65_536,
  },
];
