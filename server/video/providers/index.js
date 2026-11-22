import { createWan22Provider } from './wan22.js';
import { createHuggingFaceWan22Provider } from './huggingface-wan22.js';
import { createHuggingFaceLtxProvider } from './huggingface-ltx.js';
import { noneProvider } from './none.js';

/**
 * Provider registry. The rest of the app only talks to this interface, so a
 * different engine can be added later without touching routes or the UI.
 *
 * Required provider interface:
 *   id, name, description, capabilities
 *   availability() -> { available: boolean, reason: string }
 *   generate({ job, input, imagePath, outputPath, signal, context }) -> void
 */
export function createProviderRegistry({ config, logger, fetchImpl } = {}) {
  const providers = new Map();

  providers.set('none', noneProvider);
  providers.set('wan22-local', createWan22Provider({ config, logger }));
  providers.set(
    'huggingface-wan22',
    createHuggingFaceWan22Provider({ config, logger, fetchImpl })
  );
  providers.set(
    'huggingface-ltx',
    createHuggingFaceLtxProvider({ config, logger, fetchImpl })
  );

  return {
    get(id) {
      return providers.get(String(id || config?.video?.provider || 'wan22-local')) || null;
    },
    default() {
      return this.get(config?.video?.provider || 'wan22-local');
    },
    async list() {
      const result = [];
      for (const provider of providers.values()) {
        let availability;
        try {
          availability = await provider.availability();
        } catch (error) {
          availability = { available: false, reason: error?.message || String(error) };
        }
        result.push({
          id: provider.id,
          name: provider.name,
          description: provider.description,
          available: Boolean(availability.available),
          reason: availability.reason || '',
          capabilities: provider.capabilities || {},
          ...(availability.auth ? { auth: availability.auth } : {})
        });
      }
      return result;
    }
  };
}
