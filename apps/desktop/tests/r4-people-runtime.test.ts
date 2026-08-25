import { createM2ContentRegistry } from "@airship-restaurant/content";
import { describe, expect, it } from "vitest";
import { createR4PeopleModules } from "../src/main/r4-people-runtime";

describe("R4 people composition", () => {
  it("boots Baiyecheng and Otto with their confirmed multi-job schedules", () => {
    const people = createR4PeopleModules(createM2ContentRegistry());
    expect(people.employment.createReadModel(600).employees).toMatchObject([
      { name: "白夜城", primaryJobId: "job.chef", learnedJobIds: ["job.chef"], tags: ["employee"] },
      { name: "奥托", primaryJobId: "job.waiter", learnedJobIds: ["job.waiter", "job.local_procurer", "job.repairer"], tags: ["employee"] },
    ]);
    expect(people.employment.createReadModel(1_100).employees).toMatchObject([
      { name: "白夜城", tags: [] },
      { name: "奥托", tags: [] },
    ]);
  });

  it("restores roster state without bootstrapping duplicate employees", () => {
    const content = createM2ContentRegistry();
    const first = createR4PeopleModules(content);
    const restored = createR4PeopleModules(content, {
      characters: first.characters.exportState(),
      employment: first.employment.exportState(),
    });
    expect(restored.employment.createReadModel(600).employees).toHaveLength(2);
  });
});
