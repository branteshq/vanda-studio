import { describe, expect, it } from "vitest";
import {
  formatTurn,
  parseOptions,
  postTurns,
  summarize,
  type AgentMessage,
} from "../scripts/post-traces";

let clock = 0;

type Content = NonNullable<AgentMessage["message"]>["content"];

type ToolInput = {
  path?: string;
  query?: string;
  name?: string;
  aspectRatio?: string;
  referenceImageIds?: string[];
  editOfImageId?: string;
  imageIds?: string[];
};

type ToolOutput = {
  type: string;
  value: string | object;
};

const message = (
  order: number,
  stepOrder: number,
  role: string,
  content: Content,
  threadId = "thread-a",
): AgentMessage => ({
  _creationTime: ++clock,
  threadId,
  userId: "account-1",
  order,
  stepOrder,
  message: { role, content },
});

const call = (toolCallId: string, toolName: string, input: ToolInput) => ({
  type: "tool-call",
  toolCallId,
  toolName,
  input,
});

const result = (toolCallId: string, toolName: string, output: ToolOutput) => ({
  type: "tool-result",
  toolCallId,
  toolName,
  output,
});

describe("post traces", () => {
  const messages = [
    message(0, 0, "user", "faz um post"),
    message(0, 1, "assistant", [call("s1", "tool_search", { query: "post imagem" })]),
    message(0, 2, "tool", [
      result("s1", "tool_search", {
        type: "json",
        value: { skills: [{ name: "post-production" }], tools: [{ name: "paint" }] },
      }),
    ]),
    message(0, 3, "assistant", [
      call("r1", "read", { path: "/skills/post-production/SKILL.md" }),
      call("l1", "list", { path: "/images" }),
    ]),
    message(0, 4, "tool", [result("l1", "list", { type: "text", value: "/images\n(vazio)" })]),
    message(0, 5, "assistant", [
      call("p1", "paint", { name: "Capa", aspectRatio: "4:5", referenceImageIds: ["a", "b"] }),
    ]),
    message(0, 6, "tool", [result("p1", "paint", { type: "content", value: [] })]),
    message(0, 7, "assistant", [
      call("x1", "read", { path: "/images/capa.png" }),
      call("p2", "paint", { name: "Capa 2", aspectRatio: "4:5", editOfImageId: "img-1" }),
    ]),
    message(0, 8, "tool", [result("p2", "paint", { type: "error-text", value: "falhou" })]),
    message(0, 9, "assistant", [call("c1", "create_post", { imageIds: ["img-1"] })]),
    message(0, 10, "tool", [result("c1", "create_post", { type: "json", value: {} })]),
    message(0, 11, "assistant", [{ type: "text", text: "Pronto, rascunho criado." }]),
    // A turn that never touched a post is left out.
    message(1, 0, "user", "oi"),
    message(1, 1, "assistant", [{ type: "text", text: "Oi!" }]),
  ];

  it("keeps post turns with skills, searches, paints, reviews and create_post", () => {
    const [turn, ...rest] = postTurns(messages);

    expect(rest).toEqual([]);
    expect(turn).toMatchObject({
      prompt: "faz um post",
      skillsRead: ["post-production"],
      searches: [{ query: "post imagem", skills: ["post-production"], tools: ["paint"] }],
      imagesListed: 0,
      paints: [
        { name: "Capa", references: 2, edit: false, outcome: "ok" },
        { name: "Capa 2", references: 0, edit: true, outcome: "error" },
      ],
      reviews: ["read /images/capa.png", "edit Capa 2"],
      createPost: "ok",
      reply: "Pronto, rascunho criado.",
    });

    expect(formatTurn(turn!)).toContain('paint "Capa" 4:5 refs=2 ok');
    expect(summarize([turn!])).toContain("new paints with references: 1 of 1");
  });

  it("reports a create_post call without a result as failed, not as not run", () => {
    const [turn] = postTurns(
      messages.filter((entry) => entry.stepOrder !== 10 || entry.order !== 0),
    );

    expect(turn?.createPost).toBe("error");
  });

  it("only passes read-only deployment flags through to convex data", () => {
    expect(parseOptions(["--prod", "--limit", "10", "--thread", "t"])).toMatchObject({
      convexArgs: ["--prod"],
      limit: 10,
      thread: "t",
    });
    expect(() => parseOptions(["--push"])).toThrow("unknown option");
  });
});
