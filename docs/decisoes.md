# Decisões tomadas na construção

Decisões que o planejamento deixava em aberto ou que surgiram ao construir. Todas podem ser revistas.

| Assunto | Decisão | Motivo |
| --- | --- | --- |
| Nome | "Vitrine", provisório, num único lugar (`PLATFORM_NAME` em `src/lib/api.ts`) | Fácil de trocar quando o nome for escolhido |
| Preços | Vitrine R$ 39; Loja R$ 49 + 2%; Pro R$ 99 + 1% (editáveis no painel do admin) | Proposta do planejamento |
| Teste grátis | 14 dias com todos os recursos do Pro | O lojista experimenta tudo antes de escolher |
| Taxa por venda | Cobrada só em pagamentos online (Mercado Pago), retida por split | Pix direto e pagamento na entrega não passam por intermediário, então não há como reter; somar na fatura fica para depois |
| Meio de pagamento online | Mercado Pago, com o lojista conectando a própria conta | Mais conhecido entre pequenos vendedores; o dinheiro não passa pela plataforma |
| Pix | Pix direto com QR code e código copia e cola gerados com o valor exato | Funciona já no plano Loja, sem taxa e sem integração |
| Editor de aparência | Por seções prontas (16 tipos), com estilo, animações, menu e rodapé; rascunho, publicar e 5 versões anteriores | Cobre quase tudo que o lojista quer mudar e mantém a loja bonita no celular |
| Fontes | 15 pares do Google Fonts | Variedade sem risco de fonte ilegível |
| Animações | Opções prontas, desligadas para quem pede menos movimento no aparelho | Acessibilidade |
| Script livre do lojista | Não existe; só os códigos do Google Analytics, Meta e TikTok | Um script livre poderia roubar dados dos clientes |
| Ferramentas de anúncio | Só carregam depois que o visitante aceita os cookies | LGPD |
| Custo do produto | Oculto para visitantes (migração 0003) | É informação do lojista |
| Cobrança da mensalidade | Manual por Pix; o admin registra o pagamento e o sistema estende o vencimento | Automatizar só vale a partir de 20 a 30 lojas |
| Suspensão | Manual, pelo admin; teste vencido aparece em destaque | Evita suspender alguém por erro de cobrança |
| Avisos de pedido | Som e contador no painel (confere a cada 25 s); e-mail e WhatsApp automático ficam para depois | Os dois últimos exigem conta paga em serviço externo |
| Frete por transportadora | Ainda não; a tela avisa "em breve" | Exige conta no Melhor Envio |
| Mais vendidos | Contador `sold_count` no produto, atualizado pelo servidor | Visitantes não podem ler pedidos |
| Formatação de textos | Formatação simples (títulos, negrito, listas, links, imagens); HTML é bloqueado | Segurança |
| Admin | Exige verificação em duas etapas | O painel do admin acessa todas as lojas |

## O que ainda não foi testado com contas reais

- Banco de dados: testado em Postgres 16 e PGlite com um simulador do Supabase, não num projeto Supabase real.
- Mercado Pago: lógica testada com respostas simuladas; a documentação oficial não pôde ser aberta deste ambiente. Ver `docs/mercado-pago.md`.
- Prévia de links no Cloudflare: lógica testada; não foi publicada.
