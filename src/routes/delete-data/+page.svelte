<script lang="ts">
	import LegalPage from "$lib/components/legal/LegalPage.svelte";

	const sections = [
		{
			title: "Como solicitar a exclusão",
			paragraphs: [
				"Você pode solicitar a exclusão dos dados da sua conta Vanda Studio, dados de projetos, mídias enviadas, conteúdos gerados, dados de contas sociais conectadas e tokens armazenados de plataformas sociais.",
			],
			items: [
				"Envie uma solicitação de exclusão pelo canal de suporte indicado no app da Vanda Studio.",
				"Inclua o endereço de e-mail usado na sua conta Vanda Studio.",
				"Se a solicitação envolver dados do Instagram ou da Meta, inclua o @ do Instagram ou o nome da conta comercial conectada.",
			],
		},
		{
			title: "O que excluímos",
			items: [
				"Informações de perfil associadas à sua conta Vanda Studio.",
				"Projetos, contexto de marca, legendas geradas, mídias geradas, mídias enviadas e dados de posts agendados.",
				"Registros de contas sociais conectadas, tokens de acesso, metadados de mídias importadas, métricas de conta e métricas de posts armazenadas pela Vanda Studio.",
			],
		},
		{
			title: "Prazo",
			paragraphs: [
				"Processaremos solicitações verificadas de exclusão em prazo razoável, salvo quando a retenção for necessária por motivos legais, de segurança, prevenção a fraudes, cobrança ou conformidade.",
				"Backups e logs podem permanecer por um período limitado antes da exclusão automática, de acordo com nossas práticas operacionais de retenção.",
			],
		},
		{
			title: "Desconectar Instagram ou Meta",
			paragraphs: [
				"Você também pode revogar o acesso da Vanda Studio nas configurações da sua conta Meta ou Instagram. Revogar o acesso impede acessos futuros via API, mas não remove automaticamente todos os dados históricos já armazenados na Vanda Studio. Para remover dados armazenados, envie uma solicitação de exclusão.",
			],
		},
		{
			title: "Contato",
			paragraphs: [
				"Para solicitações de exclusão, entre em contato pelo canal de suporte indicado no app da Vanda Studio ou pelo e-mail de contato configurado para a Vanda Studio no Meta for Developers.",
			],
		},
	];
</script>

<LegalPage
	title="Instruções de Exclusão de Dados"
	description="Instruções para solicitar a exclusão de dados da conta Vanda Studio e de dados de plataformas sociais conectadas."
	updatedAt="23 de abril de 2026"
	{sections}
/>
