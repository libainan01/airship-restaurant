import type {
  CharacterDefinition,
  ContentDefinitions,
  CustomerDefinition,
  RecipeJournalDefinition,
  StoryEventDefinition,
} from "./definitions";

const CONTENT_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

function validateId(
  id: string,
  prefix: string,
  label: string,
  issues: string[],
): void {
  if (
    !CONTENT_ID_PATTERN.test(id) ||
    !id.startsWith(`${prefix}.`)
  ) {
    issues.push(
      `${label} id "${id}" must be a stable ${prefix}.* id.`,
    );
  }
}

function validateLocalization(
  key: string,
  label: string,
  localizations: Readonly<Record<string, string>>,
  issues: string[],
): void {
  validateId(key, "localization", `${label} localization`, issues);
  const text = localizations[key];
  if (text === undefined) {
    issues.push(`${label} references missing localization "${key}".`);
  } else if (text.trim().length === 0) {
    issues.push(`${label} localization "${key}" must not be empty.`);
  }
}

function cloneCharacter(
  definition: CharacterDefinition,
): CharacterDefinition {
  return Object.freeze({
    ...definition,
    ...(definition.baseSkills === undefined ? {} : {
      baseSkills: Object.freeze({ ...definition.baseSkills }),
    }),
    ...(definition.talentIds === undefined ? {} : {
      talentIds: Object.freeze([...definition.talentIds]),
    }),
  });
}

function cloneCustomer(
  definition: CustomerDefinition,
): CustomerDefinition {
  return Object.freeze({ ...definition });
}

function cloneStoryEvent(
  definition: StoryEventDefinition,
): StoryEventDefinition {
  return Object.freeze({
    ...definition,
    characterIds: Object.freeze([...definition.characterIds]),
    prerequisiteEventIds: Object.freeze([
      ...definition.prerequisiteEventIds,
    ]),
    conditions: Object.freeze(
      definition.conditions.map((condition) =>
        Object.freeze({ ...condition }),
      ),
    ),
  });
}

function cloneRecipeJournal(
  definition: RecipeJournalDefinition,
): RecipeJournalDefinition {
  return Object.freeze({
    ...definition,
    storyEventIds: Object.freeze([...definition.storyEventIds]),
  });
}

export class NarrativeContentRegistry {
  readonly #characters: ReadonlyMap<string, CharacterDefinition>;
  readonly #customers: ReadonlyMap<string, CustomerDefinition>;
  readonly #storyEvents: ReadonlyMap<string, StoryEventDefinition>;
  readonly #recipeJournals: ReadonlyMap<
    string,
    RecipeJournalDefinition
  >;
  readonly #localizations: Readonly<Record<string, string>>;

  constructor(
    definitions: ContentDefinitions,
    recipeIds: ReadonlySet<string>,
    dishIds: ReadonlySet<string>,
    issues: string[],
  ) {
    const characters = definitions.characters ?? [];
    const customers = definitions.customers ?? [];
    const storyEvents = definitions.storyEvents ?? [];
    const recipeJournals = definitions.recipeJournals ?? [];
    const localizations = definitions.localizations ?? {};

    for (const [key, text] of Object.entries(localizations)) {
      validateId(key, "localization", "Localization", issues);
      if (text.trim().length === 0) {
        issues.push(`Localization "${key}" must not be empty.`);
      }
    }

    const characterIds = new Set<string>();
    for (const character of characters) {
      validateId(character.id, "character", "Character", issues);
      if (characterIds.has(character.id)) {
        issues.push(`Duplicate character id "${character.id}".`);
      }
      characterIds.add(character.id);
      if (character.name.trim().length === 0) {
        issues.push(`Character "${character.id}" must have a name.`);
      }
      validateLocalization(
        character.localizationKey,
        `Character "${character.id}"`,
        localizations,
        issues,
      );
    }

    const customerIds = new Set<string>();
    for (const customer of customers) {
      validateId(customer.id, "customer", "Customer", issues);
      if (customerIds.has(customer.id)) {
        issues.push(`Duplicate customer id "${customer.id}".`);
      }
      customerIds.add(customer.id);
      if (customer.name.trim().length === 0) {
        issues.push(`Customer "${customer.id}" must have a name.`);
      }
      if (!characterIds.has(customer.characterId)) {
        issues.push(
          `Customer "${customer.id}" references unknown character "${customer.characterId}".`,
        );
      }
      validateLocalization(
        customer.localizationKey,
        `Customer "${customer.id}"`,
        localizations,
        issues,
      );
    }

    const storyEventIds = new Set<string>();
    for (const event of storyEvents) {
      validateId(event.id, "story", "Story event", issues);
      if (storyEventIds.has(event.id)) {
        issues.push(`Duplicate story event id "${event.id}".`);
      }
      storyEventIds.add(event.id);
    }
    for (const event of storyEvents) {
      if (event.title.trim().length === 0) {
        issues.push(`Story event "${event.id}" must have a title.`);
      }
      validateLocalization(
        event.localizationKey,
        `Story event "${event.id}"`,
        localizations,
        issues,
      );
      if (!Number.isSafeInteger(event.priority)) {
        issues.push(
          `Story event "${event.id}" priority must be a safe integer.`,
        );
      }
      if (event.characterIds.length === 0) {
        issues.push(
          `Story event "${event.id}" must reference a character.`,
        );
      }
      const seenCharacters = new Set<string>();
      for (const characterId of event.characterIds) {
        if (!characterIds.has(characterId)) {
          issues.push(
            `Story event "${event.id}" references unknown character "${characterId}".`,
          );
        }
        if (seenCharacters.has(characterId)) {
          issues.push(
            `Story event "${event.id}" repeats character "${characterId}".`,
          );
        }
        seenCharacters.add(characterId);
      }
      if (
        event.recipeId !== null &&
        !recipeIds.has(event.recipeId)
      ) {
        issues.push(
          `Story event "${event.id}" references unknown recipe "${event.recipeId}".`,
        );
      }
      const seenPrerequisites = new Set<string>();
      for (const prerequisiteId of event.prerequisiteEventIds) {
        if (
          prerequisiteId === event.id ||
          !storyEventIds.has(prerequisiteId)
        ) {
          issues.push(
            `Story event "${event.id}" has invalid prerequisite "${prerequisiteId}".`,
          );
        }
        if (seenPrerequisites.has(prerequisiteId)) {
          issues.push(
            `Story event "${event.id}" repeats prerequisite "${prerequisiteId}".`,
          );
        }
        seenPrerequisites.add(prerequisiteId);
      }
      if (event.conditions.length === 0) {
        issues.push(
          `Story event "${event.id}" must have an online condition.`,
        );
      }
      for (const condition of event.conditions) {
        if (
          condition.type !== "online-dish-sales" ||
          !dishIds.has(condition.dishItemId)
        ) {
          issues.push(
            `Story event "${event.id}" references unknown dish "${condition.dishItemId}".`,
          );
        }
        if (
          !Number.isSafeInteger(condition.quantity) ||
          condition.quantity <= 0
        ) {
          issues.push(
            `Story event "${event.id}" condition quantity must be a positive integer.`,
          );
        }
      }
    }

    const journalIds = new Set<string>();
    for (const journal of recipeJournals) {
      validateId(journal.id, "journal", "Recipe journal", issues);
      if (journalIds.has(journal.id)) {
        issues.push(`Duplicate recipe journal id "${journal.id}".`);
      }
      journalIds.add(journal.id);
      if (!recipeIds.has(journal.recipeId)) {
        issues.push(
          `Recipe journal "${journal.id}" references unknown recipe "${journal.recipeId}".`,
        );
      }
      if (!characterIds.has(journal.sourceCharacterId)) {
        issues.push(
          `Recipe journal "${journal.id}" references unknown source character "${journal.sourceCharacterId}".`,
        );
      }
      validateLocalization(
        journal.localizationKey,
        `Recipe journal "${journal.id}"`,
        localizations,
        issues,
      );
      if (journal.storyEventIds.length === 0) {
        issues.push(
          `Recipe journal "${journal.id}" must reference a story event.`,
        );
      }
      const seenEvents = new Set<string>();
      for (const storyEventId of journal.storyEventIds) {
        if (!storyEventIds.has(storyEventId)) {
          issues.push(
            `Recipe journal "${journal.id}" references unknown story event "${storyEventId}".`,
          );
        }
        if (seenEvents.has(storyEventId)) {
          issues.push(
            `Recipe journal "${journal.id}" repeats story event "${storyEventId}".`,
          );
        }
        seenEvents.add(storyEventId);
      }
    }

    this.#characters = new Map(
      characters.map((character) => {
        const cloned = cloneCharacter(character);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#customers = new Map(
      customers.map((customer) => {
        const cloned = cloneCustomer(customer);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#storyEvents = new Map(
      storyEvents.map((event) => {
        const cloned = cloneStoryEvent(event);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#recipeJournals = new Map(
      recipeJournals.map((journal) => {
        const cloned = cloneRecipeJournal(journal);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#localizations = Object.freeze({ ...localizations });
  }

  listCharacters(): readonly CharacterDefinition[] {
    return Object.freeze([...this.#characters.values()]);
  }

  listCustomers(): readonly CustomerDefinition[] {
    return Object.freeze([...this.#customers.values()]);
  }

  listStoryEvents(): readonly StoryEventDefinition[] {
    return Object.freeze([...this.#storyEvents.values()]);
  }

  listRecipeJournals(): readonly RecipeJournalDefinition[] {
    return Object.freeze([...this.#recipeJournals.values()]);
  }

  getCharacter(id: string): CharacterDefinition | undefined {
    return this.#characters.get(id);
  }

  getCustomer(id: string): CustomerDefinition | undefined {
    return this.#customers.get(id);
  }

  getStoryEvent(id: string): StoryEventDefinition | undefined {
    return this.#storyEvents.get(id);
  }

  getRecipeJournal(id: string): RecipeJournalDefinition | undefined {
    return this.#recipeJournals.get(id);
  }

  getLocalizedText(key: string): string | undefined {
    return this.#localizations[key];
  }
}
