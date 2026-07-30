import type {
  AmbientDialogueDefinition,
  ContentDefinitions,
  DialogueDefinition,
  DialogueLineDefinition,
  DialogueSpeakerDefinition,
  LocationDefinition,
  StoryDialogueDefinition,
} from "./definitions";

const CONTENT_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const AMBIENT_CONTEXTS = new Set([
  "arrival",
  "waiting",
  "eating",
  "departing",
  "idle",
]);
const FAMILIARITY_STAGES = new Set([
  "new",
  "returning",
  "regular",
]);

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

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function cloneLocation(
  definition: LocationDefinition,
): LocationDefinition {
  return Object.freeze({ ...definition });
}

function cloneSpeaker(
  definition: DialogueSpeakerDefinition,
): DialogueSpeakerDefinition {
  return Object.freeze({ ...definition });
}

function cloneLine(
  definition: DialogueLineDefinition,
): DialogueLineDefinition {
  return Object.freeze({ ...definition });
}

function cloneDialogue(
  definition: DialogueDefinition,
): DialogueDefinition {
  const lines = Object.freeze(definition.lines.map(cloneLine));
  if (definition.kind === "story") {
    return Object.freeze({
      ...definition,
      lines,
    });
  }
  return Object.freeze({
    ...definition,
    contexts: Object.freeze([...definition.contexts]),
    prerequisiteEventIds: Object.freeze([
      ...definition.prerequisiteEventIds,
    ]),
    lines,
  });
}

export class DialogueContentRegistry {
  readonly #locations: ReadonlyMap<string, LocationDefinition>;
  readonly #speakers: ReadonlyMap<
    string,
    DialogueSpeakerDefinition
  >;
  readonly #dialogues: ReadonlyMap<string, DialogueDefinition>;

  constructor(definitions: ContentDefinitions, issues: string[]) {
    const locations = definitions.locations ?? [];
    const speakers = definitions.dialogueSpeakers ?? [];
    const dialogues = definitions.dialogues ?? [];
    const storyEvents = definitions.storyEvents ?? [];
    const localizations = definitions.localizations ?? {};
    const characterIds = new Set(
      (definitions.characters ?? []).map((character) => character.id),
    );
    const storyEventIds = new Set(
      storyEvents.map((event) => event.id),
    );

    const locationIds = new Set<string>();
    for (const location of locations) {
      validateId(location.id, "location", "Location", issues);
      if (locationIds.has(location.id)) {
        issues.push(`Duplicate location id "${location.id}".`);
      }
      locationIds.add(location.id);
      if (location.name.trim().length === 0) {
        issues.push(`Location "${location.id}" must have a name.`);
      }
      validateLocalization(
        location.localizationKey,
        `Location "${location.id}"`,
        localizations,
        issues,
      );
    }

    const speakerIds = new Set<string>();
    for (const speaker of speakers) {
      validateId(speaker.id, "speaker", "Dialogue speaker", issues);
      if (speakerIds.has(speaker.id)) {
        issues.push(`Duplicate dialogue speaker id "${speaker.id}".`);
      }
      speakerIds.add(speaker.id);
      if (speaker.name.trim().length === 0) {
        issues.push(
          `Dialogue speaker "${speaker.id}" must have a name.`,
        );
      }
      if (
        speaker.characterId !== null &&
        !characterIds.has(speaker.characterId)
      ) {
        issues.push(
          `Dialogue speaker "${speaker.id}" references unknown character "${speaker.characterId}".`,
        );
      }
      validateLocalization(
        speaker.localizationKey,
        `Dialogue speaker "${speaker.id}"`,
        localizations,
        issues,
      );
    }

    const dialogueIds = new Set<string>();
    const dialogueKinds = new Map<string, DialogueDefinition["kind"]>();
    for (const dialogue of dialogues) {
      validateId(dialogue.id, "dialogue", "Dialogue", issues);
      if (dialogueIds.has(dialogue.id)) {
        issues.push(`Duplicate dialogue id "${dialogue.id}".`);
      }
      dialogueIds.add(dialogue.id);
      dialogueKinds.set(dialogue.id, dialogue.kind);
    }

    for (const dialogue of dialogues) {
      this.#validateLines(
        dialogue,
        speakerIds,
        localizations,
        issues,
      );
      if (dialogue.kind === "ambient") {
        this.#validateAmbient(
          dialogue,
          locationIds,
          storyEventIds,
          issues,
        );
      }
    }

    for (const event of storyEvents) {
      if (event.dialogueId === undefined || event.dialogueId === null) {
        continue;
      }
      if (!dialogueIds.has(event.dialogueId)) {
        issues.push(
          `Story event "${event.id}" references unknown dialogue "${event.dialogueId}".`,
        );
      } else if (dialogueKinds.get(event.dialogueId) !== "story") {
        issues.push(
          `Story event "${event.id}" must reference a story dialogue.`,
        );
      }
    }

    this.#locations = new Map(
      locations.map((location) => {
        const cloned = cloneLocation(location);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#speakers = new Map(
      speakers.map((speaker) => {
        const cloned = cloneSpeaker(speaker);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#dialogues = new Map(
      dialogues.map((dialogue) => {
        const cloned = cloneDialogue(dialogue);
        return [cloned.id, cloned] as const;
      }),
    );
  }

  listLocations(): readonly LocationDefinition[] {
    return Object.freeze([...this.#locations.values()]);
  }

  listSpeakers(): readonly DialogueSpeakerDefinition[] {
    return Object.freeze([...this.#speakers.values()]);
  }

  listDialogues(): readonly DialogueDefinition[] {
    return Object.freeze([...this.#dialogues.values()]);
  }

  listAmbientDialogues(): readonly AmbientDialogueDefinition[] {
    return Object.freeze(
      [...this.#dialogues.values()].filter(
        (dialogue): dialogue is AmbientDialogueDefinition =>
          dialogue.kind === "ambient",
      ),
    );
  }

  listStoryDialogues(): readonly StoryDialogueDefinition[] {
    return Object.freeze(
      [...this.#dialogues.values()].filter(
        (dialogue): dialogue is StoryDialogueDefinition =>
          dialogue.kind === "story",
      ),
    );
  }

  getLocation(id: string): LocationDefinition | undefined {
    return this.#locations.get(id);
  }

  getSpeaker(id: string): DialogueSpeakerDefinition | undefined {
    return this.#speakers.get(id);
  }

  getDialogue(id: string): DialogueDefinition | undefined {
    return this.#dialogues.get(id);
  }

  #validateLines(
    dialogue: DialogueDefinition,
    speakerIds: ReadonlySet<string>,
    localizations: Readonly<Record<string, string>>,
    issues: string[],
  ): void {
    if (dialogue.lines.length === 0) {
      issues.push(`Dialogue "${dialogue.id}" must contain a line.`);
      return;
    }
    dialogue.lines.forEach((line, index) => {
      if (!speakerIds.has(line.speakerId)) {
        issues.push(
          `Dialogue "${dialogue.id}" line ${index + 1} references unknown speaker "${line.speakerId}".`,
        );
      }
      validateLocalization(
        line.localizationKey,
        `Dialogue "${dialogue.id}" line ${index + 1}`,
        localizations,
        issues,
      );
      if (!isPositiveInteger(line.durationMs)) {
        issues.push(
          `Dialogue "${dialogue.id}" line ${index + 1} duration must be a positive integer.`,
        );
      }
    });
  }

  #validateAmbient(
    dialogue: AmbientDialogueDefinition,
    locationIds: ReadonlySet<string>,
    storyEventIds: ReadonlySet<string>,
    issues: string[],
  ): void {
    if (!locationIds.has(dialogue.locationId)) {
      issues.push(
        `Ambient dialogue "${dialogue.id}" references unknown location "${dialogue.locationId}".`,
      );
    }
    if (
      dialogue.contexts.length === 0 ||
      dialogue.contexts.some(
        (context) => !AMBIENT_CONTEXTS.has(context),
      ) ||
      new Set(dialogue.contexts).size !== dialogue.contexts.length
    ) {
      issues.push(
        `Ambient dialogue "${dialogue.id}" must define unique valid contexts.`,
      );
    }
    if (!FAMILIARITY_STAGES.has(dialogue.minimumFamiliarity)) {
      issues.push(
        `Ambient dialogue "${dialogue.id}" has invalid familiarity.`,
      );
    }
    if (
      !isPositiveInteger(dialogue.weight) ||
      !isNonNegativeInteger(dialogue.cooldownMs) ||
      !isPositiveInteger(dialogue.maxPlaysPerSession)
    ) {
      issues.push(
        `Ambient dialogue "${dialogue.id}" weight, cooldown and session limit are invalid.`,
      );
    }
    const prerequisites = new Set<string>();
    for (const eventId of dialogue.prerequisiteEventIds) {
      if (!storyEventIds.has(eventId)) {
        issues.push(
          `Ambient dialogue "${dialogue.id}" references unknown prerequisite "${eventId}".`,
        );
      }
      if (prerequisites.has(eventId)) {
        issues.push(
          `Ambient dialogue "${dialogue.id}" repeats prerequisite "${eventId}".`,
        );
      }
      prerequisites.add(eventId);
    }
  }
}
