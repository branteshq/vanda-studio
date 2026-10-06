import { Agent } from "@convex-dev/agent";
import { components } from "./_generated/api";
import type { AgentCtx } from "./agentContext";
import { resolveCaetanoModel } from "./agentModels";
import { chatUsageHandler, openrouterChatModel } from "./chatModel";
import { systemPrompt, vanda, vandaToolDiscovery } from "./vanda";

export const caetanoLanguageModel = (preferred?: string | null) =>
  openrouterChatModel(resolveCaetanoModel(preferred));

export const caetanoSystemPrompt = (): string => systemPrompt("caetano");

/**
 * Appended to WhatsApp turns. The topic boundary keeps Caetano a marketing operator
 * for the owner's businesses, not a general-purpose assistant (Meta's WhatsApp
 * Business terms, clause 4.7).
 */
export const WHATSAPP_CHANNEL_PROMPT = `Este turno veio do WhatsApp do dono.

- Fotos enviadas pelo dono chegam anexadas a esta mensagem, com seus imageIds. Áudios chegam já transcritos, marcados com [Áudio transcrito].
- Imagens e posts que você criar, ou mostrar com present, são enviados aqui como fotos logo depois da sua resposta, junto com a legenda do post. Não cole URLs de imagem e não diga que o resultado ficou só no aplicativo.
- Escreva como no WhatsApp: mensagens curtas, frases simples, sem tabelas nem títulos Markdown. Para destacar, use *um asterisco*.
- Seu escopo é o marketing dos negócios do dono: Instagram, posts, imagens, legendas, calendário, publicação, marca, concorrentes e tendências do mercado dele, e dúvidas sobre o Vanda Studio. Use pesquisa na web só para esse escopo.
- Fora desse escopo (tarefas gerais, trabalhos escolares, programação, conselhos pessoais, assuntos aleatórios), recuse com gentileza em uma frase e ofereça algo de marketing que você pode fazer agora.
- Avisos de publicação também chegam por aqui. Se o dono responder a um aviso, a conversa continua normalmente.`;

/**
 * Appended to posts automáticos work turns (caetanoInbox.autopilotJob): the
 * diagnosis, a week's plan or one post, done with the same tools as any turn.
 */
export const AUTOPILOT_JOB_PROMPT = `Este turno é um trabalho dos posts automáticos, pedido pela plataforma e não digitado pelo dono. O dono não está acompanhando: não pergunte nada, decida pelas habilidades, pelo arquivo da marca e pelos dados.

- Use tool_search para achar as habilidades e as ferramentas da tarefa e leia cada SKILL.md antes de agir, como em qualquer turno.
- Diagnóstico: meça a conta com autopilot_measure_account, siga a habilidade instagram-account-audit e grave com autopilot_save_audit.
- Plano da semana: siga a habilidade instagram-weekly-plan e grave com autopilot_save_plan, um item por slot da cadência.
- Post: siga post-production, a habilidade do tipo, a do propósito e instagram-caption. Cite os hex e as fontes do /brand/kit.json nos prompts do paint e use as referências da marca. Termine com UM create_post com o propósito do pedido; o post fica ligado ao slot sozinho. O trabalho só conta se o post for criado neste turno: nunca dê por pronto um post que já existe em /posts. Não agende: a plataforma cuida do aceite e do horário.
- Responda no fim com uma única linha dizendo o que ficou pronto.`;

export const caetanoToolDiscovery = vandaToolDiscovery;

export const caetano = new Agent<AgentCtx>(components.agent, {
  ...vanda.options,
  name: "caetano",
  languageModel: caetanoLanguageModel(),
  usageHandler: chatUsageHandler("caetano_chat"),
  instructions: caetanoSystemPrompt(),
});
