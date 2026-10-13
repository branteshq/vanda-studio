# Formatos de anúncio

Cada formato é uma composição pronta, testada em execuções reais: uma ideia de layout com prompt-base, texto e revisão. Use um quando o dono citar o nome (ou um apelido da lista) ou quando ele servir melhor ao post do que uma arte livre, principalmente se a seção Design manda Evoluir o layout do feed. Leia só o arquivo do formato escolhido.

O formato define a composição da arte. Não substitui type, propósito nem format, e não troca a identidade da marca: cores de Manter, assinatura, voz e quem aparece entram no prompt-base nos campos da marca.

Regras de todo formato:

- Herói: o que representa a oferta neste post, escolhido pelo pedido e pelo arquivo da marca (produto, prato, pessoa, lugar ou um objeto físico que represente o serviço). Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova; só edite a foto com editOfImageId se o dono pedir para mantê-la e mudar só fundo ou estilo. Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Prompt-base: comece o prompt do paint por ele, em inglês, preenchendo todos os campos entre colchetes com fatos do pedido e do arquivo da marca. Nenhum colchete pode sobrar.
- Revisão: cumpra cada item da Revisão do formato na imagem e corrija com editOfImageId o que falhar, antes do create_post.
- Nunca invente avaliações, depoimentos, números, estoque, ofertas, certificações ou alegações de saúde, e não use marcas ou telas de terceiros.

## Formatos

- `formats/alerta-estoque-baixo.md`, alerta de estoque baixo: restam poucas unidades, último lote, vagas restantes ou saindo de linha; só com estoque confirmado. Propósito: promocional.
- `formats/avaliacoes.md`, avaliações: avaliação real de cliente, com estrelas e nota, em cartão ao lado do herói. Propósito: prova_social.
- `formats/aviso.md`, aviso: selo AVISO com mensagem curta para mudança de horário, feriado, fechamento ou data de funcionamento. Propósito: informativo ou anuncio.
- `formats/combo.md`, combo: kit ou conjunto de itens ou serviços juntos por um preço só: leve junto, compre o combo. Propósito: produto ou promocional.
- `formats/depoimento.md`, depoimento: testemunho real de cliente em citação grande, com identificação autorizada e o item ao lado. Propósito: prova_social.
- `formats/efeito-colateral.md`, efeito colateral: aviso bem-humorado com consequência leve e engraçada do herói: brincadeira, humor, aviso. Propósito: produto ou comunidade.
- `formats/emergencia.md`, emergência: chamada urgente para parar a rolagem, com faixas diagonais e tipografia grande. Propósito: promocional ou anuncio.
- `formats/estilo-reddit.md`, estilo Reddit: relato real de cliente ou comentário em cartão de fórum (thread, print de fórum), com a citação em destaque. Propósito: prova_social ou comunidade.
- `formats/floating-3d.md`, floating 3D: render 3D premium com o herói levitando, elementos suspensos em camadas em volta, 3D flutuante, sem explosão. Propósito: produto ou promocional.
- `formats/iridescente.md`, iridescente: cena futurista e holográfica, com vidro fluido, fitas translúcidas, bolhas e reflexos prismáticos em volta do herói. Propósito: produto ou anuncio.
- `formats/manchete-com-dado.md`, manchete com dado: número real do seu caixa como manchete, com fonte exata no rodapé: infográfico, estatística própria. Propósito: dados.
- `formats/massinha.md`, massinha: cenário tátil de massinha ou argila moldada à mão em volta do herói: play-doh, claymation, argila. Propósito: produto ou institucional.
- `formats/meme.md`, meme: piada em dois quadros ou uma reação, humor original sobre o negócio, serviço ou item: tirinha, reação, piada. Propósito: expressao_cultural, comunidade ou produto.
- `formats/mensagem-de-texto.md`, mensagem de texto: conversa fictícia de chat em dois balões, com o herói do negócio apoiado ao lado. Propósito: comunidade, storytelling ou produto.
- `formats/mito-vs-verdade.md`, mito vs verdade: corrija uma crença comum em dois cartões: mito em cima, verdade embaixo. Propósito: educacional.
- `formats/motivos.md`, motivos: lista de 3 a 5 razões para conhecer a marca, com cartões numerados ao redor do herói (vantagens). Propósito: institucional ou produto.
- `formats/nao-compre-isso.md`, não compre isso: chamada irônica contra a compra comum que apresenta a alternativa da marca. Propósito: produto ou promocional.
- `formats/nao-seja-burro.md`, não seja burro: alerta provocador sobre um hábito comum, em cartaz de alto contraste, sem insultar quem lê. Propósito: produto ou comunidade.
- `formats/nativo.md`, nativo: foto de celular do dia a dia, com cara de feed comum e o herói integrado à cena. Propósito: produto, bastidores ou institucional.
- `formats/nos-vs-eles.md`, nós vs eles: comparação lado a lado entre a nossa escolha e a alternativa comum, com dois lados equilibrados. Propósito: produto ou institucional.
- `formats/nos-vs-nos.md`, nós vs nós: o mesmo item em duas situações de uso, lado a lado, com cenário e luz diferentes. Propósito: produto ou storytelling.
- `formats/notas-do-iphone.md`, notas do iPhone: lista curta de recomendação pessoal e casual, como anotação do celular, para qualquer negócio ou serviço. Propósito: produto ou educacional.
- `formats/noticia-urgente.md`, notícia urgente: manchete de última hora com faixa de urgência para avisar uma novidade ou chegada da marca. Propósito: anuncio.
- `formats/novo-vs-antigo.md`, novo vs antigo: painéis lado a lado: antes e depois, o jeito antigo contra o novo, ou a versão anterior contra a atual. Propósito: anuncio ou produto.
- `formats/oferta.md`, oferta: preço ou percentual em destaque, item ou serviço ao lado e chamada curta. Para combo, preço especial ou dias da semana. Propósito: promocional.
- `formats/pedimos-desculpas.md`, pedimos desculpas: pedido de desculpas bem-humorado por algo que o seu negócio faz bem demais; humor, desculpa de brincadeira. Propósito: produto ou institucional.
- `formats/pesquisa-no-google.md`, pesquisa no Google: a pergunta que o cliente digita numa busca genérica e a marca como solução. Propósito: produto, institucional ou educacional.
- `formats/podcast-de-ia.md`, podcast de IA: conversa gravada: apresentador ao microfone num estúdio, herói na mesa e legenda curta. Propósito: produto, anuncio ou editorial.
- `formats/print-de-e-mail.md`, print de e-mail: e-mail ilustrativo com assunto, mensagem curta e o item ou serviço; para anunciar por e-mail, lançamento ou aviso. Propósito: anuncio ou produto.
- `formats/problema-vs-solucao.md`, problema vs solução: dois painéis lado a lado: a situação do dia a dia e a solução da marca, na mesma cena. Propósito: produto ou educacional.
- `formats/problemas-riscados.md`, problemas riscados: riscar o que incomoda o cliente e destacar a alternativa; também riscado, dor riscada, o que não quero. Propósito: produto ou promocional.
- `formats/quadro-branco.md`, quadro branco: explicar uma regra, valor ou condição à mão num quadro, com desenho, seta e foto presa com fita. Propósito: educacional ou produto.
- `formats/rabisco.md`, rabisco: desenhos à mão em tinta preta em volta do item, papel claro, jeito de caderno. Propósito: produto ou institucional.
- `formats/roteiro.md`, roteiro: gesto de polegar e indicador quase encostados, para dizer que a pessoa está a um passo de escolher ou agendar. Propósito: promocional ou produto.
- `formats/scroll-stopper.md`, scroll stopper: anúncio de impacto que para a rolagem: scrollstopper, explosão congelada de elementos em volta do herói, splash. Propósito: produto ou promocional.
- `formats/story-do-instagram.md`, story do Instagram: stories verticais 9:16 em tela cheia, herói fotografado no seu mundo, chamada curta e áreas livres. Propósito: promocional ou produto.
- `formats/sunbeam.md`, sunbeam: fotografia acolhedora com luz de sol de janela, golden hour, sombras de folhas e clima editorial lifestyle. Propósito: produto ou institucional.
- `formats/tela-verde.md`, tela verde: apresentador recortado na frente de uma cena com o herói atrás, estilo green screen de criador. Propósito: produto ou educacional.
- `formats/texto-na-pele.md`, texto na pele: frase escrita à tinta lavável no braço ou na mão, com o herói inteiro ao lado, sem contato. Propósito: anuncio, produto ou institucional.
- `formats/tier-list.md`, tier list: ranking S, A e B de opções da mesma categoria, com critério escrito e faixas coloridas. Propósito: comunidade, educacional ou produto.
- `formats/tiny-planet.md`, tiny planet: planeta em miniatura, mundo esférico: o herói em pé no topo, com o mundo de origem em volta, diorama publicitário. Propósito: produto ou institucional.
- `formats/transformacao.md`, transformação: antes e depois em duas metades da mesma cena, para mostrar a mudança de um serviço, peça ou espaço. Propósito: prova_social ou produto.
- `formats/truque-101.md`, truque 101: dica rápida em passo a passo numerado, tutorial básico: dica em 3 passos, tutorial 101, como fazer. Propósito: educacional.
- `formats/voce-pode-evitar.md`, você pode evitar: um incômodo do dia a dia que dá para evitar, e a alternativa que a marca oferece. Propósito: produto ou educacional.
- `formats/x-sinais.md`, X sinais: lista numerada de sinais que mostram quando algo precisa de atenção, como '3 sinais de que…'. Propósito: educacional.
- `formats/zero-estrelas.md`, zero estrelas: cinco estrelas vazias para uma situação chata, com a marca como saída. Avaliação negativa, nota zero, piada. Propósito: anuncio ou comunidade.
