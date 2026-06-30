import { describe, it, expect } from "vitest";
import {
  nextWizardStep,
  parseLegacyNotes,
  targetTypeForDomain,
  allowedDomainsForFixedTarget,
  resolveEffectiveDomain,
  computeTargetOk,
  canSubmitTask,
  normalizeTaskStatus,
  normalizeTaskPriority,
  buildTaskPayload,
  buildTaskFormSnapshot,
  WIZARD_STEPS,
  type TaskPayloadInput,
  type TaskSnapshotInput,
} from "@/components/tasks/TaskUpsertDialog.helpers";

// Characterization tests for the logic extracted out of TaskUpsertDialog — these
// pin the dialog's current behavior so the component split can't change it.

describe("nextWizardStep", () => {
  it("starts at the first step from null or an unknown step", () => {
    expect(nextWizardStep(null)).toBe("description");
    expect(nextWizardStep("nope")).toBe("description");
  });
  it("advances to the following step", () => {
    expect(nextWizardStep("description")).toBe("domain");
    expect(nextWizardStep("people")).toBe("labels");
  });
  it("returns null past the last step", () => {
    expect(nextWizardStep(WIZARD_STEPS[WIZARD_STEPS.length - 1])).toBeNull();
  });
});

describe("parseLegacyNotes", () => {
  it("returns [] for empty/blank input", () => {
    expect(parseLegacyNotes(null)).toEqual([]);
    expect(parseLegacyNotes("   ")).toEqual([]);
  });
  it("parses a well-formed [stamp] author: message block", () => {
    const [note] = parseLegacyNotes("[01/01/2024 10:00] דנה: התקשרתי ללקוח");
    expect(note).toEqual({
      raw: "[01/01/2024 10:00] דנה: התקשרתי ללקוח",
      stamp: "01/01/2024 10:00",
      author: "דנה",
      message: "התקשרתי ללקוח",
    });
  });
  it("splits multiple blocks on blank lines", () => {
    const notes = parseLegacyNotes("[t1] a: one\n\n[t2] b: two");
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.message)).toEqual(["one", "two"]);
  });
  it("keeps an unparseable block as raw with null fields", () => {
    const [note] = parseLegacyNotes("just some free text");
    expect(note).toEqual({ raw: "just some free text", stamp: null, author: null, message: null });
  });
});

describe("targetTypeForDomain", () => {
  it("maps logistics→project, property_management→property, else null", () => {
    expect(targetTypeForDomain("logistics_projects")).toBe("project");
    expect(targetTypeForDomain("property_management")).toBe("property");
    expect(targetTypeForDomain("general_business")).toBeNull();
  });
});

describe("allowedDomainsForFixedTarget", () => {
  it("returns all business domains when there is no fixed target", () => {
    expect(allowedDomainsForFixedTarget(null, "general_business").length).toBeGreaterThan(1);
  });
  it("locks to the single matching domain for a project/property target", () => {
    expect(allowedDomainsForFixedTarget({ type: "project", id: "p1" }, "general_business")).toEqual(["logistics_projects"]);
    expect(allowedDomainsForFixedTarget({ type: "property", id: "x1" }, "general_business")).toEqual(["property_management"]);
  });
});

describe("resolveEffectiveDomain", () => {
  const allowed = ["sales", "general_business"] as const;
  it("keeps an empty (unchosen) domain empty", () => {
    expect(resolveEffectiveDomain("", [...allowed], "general_business")).toBe("");
  });
  it("passes an allowed domain through", () => {
    expect(resolveEffectiveDomain("sales", [...allowed], "general_business")).toBe("sales");
  });
  it("falls back to the first allowed domain when the current one isn't allowed", () => {
    expect(resolveEffectiveDomain("spaceit", [...allowed], "general_business")).toBe("sales");
  });
  it("falls back to the default domain when the allowed list is empty", () => {
    expect(resolveEffectiveDomain("spaceit", [], "general_business")).toBe("general_business");
  });
});

describe("computeTargetOk", () => {
  it("requires a non-empty id for a fixed target", () => {
    expect(computeTargetOk({ effectiveTarget: { type: "project", id: "p1" }, derivedTargetType: null, projectId: "", propertyId: "" })).toBe(true);
    expect(computeTargetOk({ effectiveTarget: { type: "project", id: "" }, derivedTargetType: null, projectId: "", propertyId: "" })).toBe(false);
  });
  it("requires the matching link when a domain implies one", () => {
    expect(computeTargetOk({ effectiveTarget: null, derivedTargetType: "project", projectId: "p1", propertyId: "" })).toBe(true);
    expect(computeTargetOk({ effectiveTarget: null, derivedTargetType: "project", projectId: "", propertyId: "" })).toBe(false);
    expect(computeTargetOk({ effectiveTarget: null, derivedTargetType: "property", projectId: "", propertyId: "x1" })).toBe(true);
  });
  it("is always ok when no link is required", () => {
    expect(computeTargetOk({ effectiveTarget: null, derivedTargetType: null, projectId: "", propertyId: "" })).toBe(true);
  });
});

describe("canSubmitTask", () => {
  it("needs a non-blank subject and a satisfied target", () => {
    expect(canSubmitTask("  ", true)).toBe(false);
    expect(canSubmitTask("שם", false)).toBe(false);
    expect(canSubmitTask("שם", true)).toBe(true);
  });
});

describe("normalizeTaskStatus / normalizeTaskPriority", () => {
  it("passes valid values through and defaults invalid ones", () => {
    expect(normalizeTaskStatus("done")).toBe("done");
    expect(normalizeTaskStatus("garbage")).toBe("todo");
    expect(normalizeTaskStatus(null)).toBe("todo");
    expect(normalizeTaskPriority("urgent")).toBe("urgent");
    expect(normalizeTaskPriority(42)).toBe("medium");
  });
});

function payloadInput(overrides: Partial<TaskPayloadInput> = {}): TaskPayloadInput {
  return {
    effectiveTarget: null,
    derivedTargetType: null,
    effectiveDomain: "general_business",
    projectId: "",
    propertyId: "",
    subject: "  קרא ללקוח  ",
    description: "   ",
    dueDate: "",
    dueTime: "",
    city: "  ",
    address: "",
    assignedUserId: "",
    memberIds: [],
    tagIds: [],
    pendingReminders: [],
    priority: "medium",
    status: "todo",
    isPrivate: false,
    ...overrides,
  };
}

describe("buildTaskPayload", () => {
  it("trims the subject and collapses blank optionals to null", () => {
    const p = buildTaskPayload(payloadInput());
    expect(p.subject).toBe("קרא ללקוח");
    expect(p.description).toBeNull();
    expect(p.city).toBeNull();
    expect(p.due_date).toBeNull();
    expect(p.assigned_user_id).toBeNull();
  });

  it("defaults an empty domain to general_business with no link", () => {
    const p = buildTaskPayload(payloadInput({ effectiveDomain: "" }));
    expect(p.business_domain).toBe("general_business");
    expect(p.project_id).toBeNull();
    expect(p.property_id).toBeNull();
  });

  it("uses the picked project id for a project domain", () => {
    const p = buildTaskPayload(payloadInput({ derivedTargetType: "project", effectiveDomain: "logistics_projects", projectId: "proj-1" }));
    expect(p.project_id).toBe("proj-1");
    expect(p.property_id).toBeNull();
  });

  it("a fixed target overrides the picked id", () => {
    const p = buildTaskPayload(
      payloadInput({ effectiveTarget: { type: "property", id: "fixed-x" }, derivedTargetType: null, propertyId: "ignored" })
    );
    expect(p.property_id).toBe("fixed-x");
  });

  it("maps staged reminders to ISO timestamps and null-trims their content", () => {
    const p = buildTaskPayload(
      payloadInput({ pendingReminders: [{ remind_at: "2024-05-01T09:00:00Z", content: "  שיחה  " }, { remind_at: "2024-05-02T09:00:00Z", content: "  " }] })
    );
    expect(p.reminders[0].remind_at).toBe("2024-05-01T09:00:00.000Z");
    expect(p.reminders[0].content).toBe("שיחה");
    expect(p.reminders[1].content).toBeNull();
  });
});

describe("buildTaskFormSnapshot", () => {
  function snap(overrides: Partial<TaskSnapshotInput> = {}): TaskSnapshotInput {
    return {
      effectiveDomain: "sales",
      projectId: "",
      propertyId: "",
      subject: "  task  ",
      description: "  desc ",
      dueDate: "",
      dueTime: "",
      city: " ",
      address: "",
      assignedUserId: "u1",
      memberIds: ["b", "a"],
      priority: "high",
      status: "todo",
      isPrivate: false,
      ...overrides,
    };
  }

  it("trims text fields and sorts memberIds so it is order-independent", () => {
    const a = buildTaskFormSnapshot(snap({ memberIds: ["a", "b"] }));
    const b = buildTaskFormSnapshot(snap({ memberIds: ["b", "a"] }));
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.subject).toBe("task");
    expect(parsed.memberIds).toEqual(["a", "b"]);
  });

  it("changes when a meaningful field changes", () => {
    expect(buildTaskFormSnapshot(snap())).not.toBe(buildTaskFormSnapshot(snap({ status: "done" })));
  });
});
