import type { DomainEvent } from "./domain-event-bus";
import { DomainEventBus } from "./domain-event-bus";

export interface TransactionalParticipant {
  readonly transactionParticipantId: string;
  beginTransaction(): TransactionParticipantSession;
}

export interface TransactionParticipantSession {
  validateTransaction(): void;
  commitTransaction(): void;
  rollbackTransaction(): void;
}

export interface TransactionWorkContext {
  emit(event: DomainEvent): void;
}

export interface TransactionResult<TValue> {
  readonly value: TValue;
  readonly committedEventIds: readonly string[];
}

export class TransactionScope {
  readonly #eventBus: DomainEventBus;

  constructor(eventBus: DomainEventBus) {
    this.#eventBus = eventBus;
  }

  run<TValue>(
    participants: readonly TransactionalParticipant[],
    work: (context: TransactionWorkContext) => TValue,
  ): TransactionResult<TValue> {
    this.#assertUniqueParticipants(participants);
    const begun: TransactionParticipantSession[] = [];
    const events: DomainEvent[] = [];
    try {
      for (const participant of participants) {
        begun.push(participant.beginTransaction());
      }
      const value = work({ emit: (event) => events.push(event) });
      this.#eventBus.validate(events);
      for (const session of begun) {
        session.validateTransaction();
      }
      for (const session of begun) {
        session.commitTransaction();
      }
      const report = this.#eventBus.publishAll(events);
      return Object.freeze({
        value,
        committedEventIds: report.publishedEventIds,
      });
    } catch (error: unknown) {
      const rollbackErrors: unknown[] = [];
      for (const session of begun.reverse()) {
        try {
          session.rollbackTransaction();
        } catch (rollbackError: unknown) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Transaction failed and at least one participant could not roll back.",
        );
      }
      throw error;
    }
  }

  #assertUniqueParticipants(
    participants: readonly TransactionalParticipant[],
  ): void {
    const ids = new Set<string>();
    for (const participant of participants) {
      if (participant.transactionParticipantId.length === 0) {
        throw new Error("Transaction participant id must not be empty.");
      }
      if (ids.has(participant.transactionParticipantId)) {
        throw new Error(
          `Duplicate transaction participant: ${participant.transactionParticipantId}`,
        );
      }
      ids.add(participant.transactionParticipantId);
    }
  }
}
