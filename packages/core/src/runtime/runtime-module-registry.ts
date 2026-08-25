import type { DomainModule } from "../modules";

export class RuntimeModuleRegistry {
  readonly #modules = new Map<string, DomainModule>();

  register<TModule extends DomainModule>(module: TModule): () => void {
    if (module.moduleId.length === 0) throw new Error("Runtime module id must not be empty.");
    if (this.#modules.has(module.moduleId)) {
      throw new Error(`Runtime module already registered: ${module.moduleId}`);
    }
    this.#modules.set(module.moduleId, module);
    return () => {
      if (this.#modules.get(module.moduleId) === module) this.#modules.delete(module.moduleId);
    };
  }

  get<TModule extends DomainModule>(moduleId: string): TModule | null {
    return (this.#modules.get(moduleId) as TModule | undefined) ?? null;
  }

  require<TModule extends DomainModule>(moduleId: string): TModule {
    const module = this.get<TModule>(moduleId);
    if (module === null) throw new Error(`Runtime module not found: ${moduleId}`);
    return module;
  }

  listModuleIds(): readonly string[] {
    return Object.freeze([...this.#modules.keys()].sort());
  }
}
