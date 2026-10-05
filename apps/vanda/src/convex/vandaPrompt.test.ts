import { describe, expect, it } from "vitest";
import { z } from "zod";
import { caetano, WHATSAPP_CHANNEL_PROMPT } from "./caetanoAgent";
import { systemPrompt, vanda } from "./vanda";

describe("Vanda routing prompt", () => {
  it.each(["vanda", "caetano"] as const)("routes %s to post skills through tool_search", (role) => {
    const prompt = systemPrompt(role);
    expect(prompt).toContain("busque no tool_search a habilidade post-production");
    expect(prompt).toContain("produção visual é exclusivamente por paint");
    expect(prompt).not.toContain("<available_skills>");
    expect(prompt).not.toMatch(
      /run_code|\/templates|post-instagram-template|prompt-foto-fiel|creating-carousel-images|post-purposes|post-router/,
    );
    // Slide consistency holds even in a revision turn that loads no type skill.
    expect(prompt).toContain("mantenha linguagem visual consistente");
    expect(prompt).toContain("inclusive ao refazer um único slide");
    // Format and purpose guidance lives in the discovered skills, not every turn.
    expect(prompt).not.toContain("Propósitos de post");
  });

  it("requires format, purpose and justification when creating a post", () => {
    const schema = vanda.options.tools!.create_post!.inputSchema;

    if (!(schema instanceof z.ZodType)) throw new Error("create_post must use a zod schema");

    const valid = {
      imageIds: ["img"],
      caption: "Novo bolo",
      type: "image",
      format: "4:5",
      purpose: "anuncio",
      rationale:
        "image porque é uma novidade de uma frase; anuncio porque há data, não promocional porque não há desconto.",
    };

    expect(schema.safeParse(valid).success).toBe(true);

    for (const key of ["type", "format", "purpose", "rationale"] as const) {
      const { [key]: _omitted, ...rest } = valid;
      expect(schema.safeParse(rest).success).toBe(false);
    }

    expect(schema.safeParse({ ...valid, type: "reel" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, type: "feed" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, format: "2:3" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, purpose: "vendas" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, rationale: "porque sim" }).success).toBe(false);
  });

  it("tells Caetano on WhatsApp that media works and keeps it to marketing", () => {
    expect(WHATSAPP_CHANNEL_PROMPT).not.toMatch(/sandbox|somente texto|conversa web/);
    expect(WHATSAPP_CHANNEL_PROMPT).toContain("[Áudio transcrito]");
    expect(WHATSAPP_CHANNEL_PROMPT).toContain("são enviados aqui como fotos");
    expect(WHATSAPP_CHANNEL_PROMPT).toContain("recuse com gentileza");
  });

  it("does not expose code execution in either agent's tool catalog", () => {
    for (const agent of [vanda, caetano]) {
      expect(agent.options.tools).not.toHaveProperty("run_code");
      expect(agent.options.tools).toHaveProperty("paint");
    }
  });
});
