# FST

Mini "Discord" só para você e seus amigos: salas com chat de texto, voz e compartilhamento de tela de **360p até 1080p 60 fps**. O vídeo e o áudio vão direto entre os navegadores (WebRTC); o servidor só apresenta vocês uns aos outros.

## Rodar no seu PC

Precisa do [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Abra http://localhost:3000, crie sua conta e entre (todo mundo entra na mesma sala).

## Chamar os amigos (HTTPS é obrigatório)

Para compartilhar tela, os navegadores exigem HTTPS (só `localhost` escapa disso). O jeito mais rápido, grátis e sem mexer no roteador é um túnel:

```bash
# com o servidor rodando (npm start), em outro terminal:
cloudflared tunnel --url http://localhost:3000
```

Ele mostra um link `https://....trycloudflare.com`. Mande para os amigos e pronto. Dentro da sala, o botão **Convidar** copia o link.

Alternativa fixa: suba a pasta em Render, Railway ou Fly.io (todos dão HTTPS).

### Link novo sem avisar ninguém (só no app desktop)

O link `trycloudflare.com` muda sempre que o túnel reinicia. Para o **app desktop** achar o link novo sozinho, em vez de rodar o `cloudflared` na mão, use o `FST-Tunel.bat` (ou `node publicar-link.js`): ele abre o túnel e grava o link num **gist público** do GitHub; o app lê esse gist ao abrir, quando o link salvo não responde e a cada 3 minutos.

Configuração (uma vez):

1. O gist já existe e o ID (`9bd12a3a876fd81a0089a0c041ed5e40`) já está no script e no `server-default.json`. Ele precisa ser **público**.
2. Em GitHub > Settings > Developer settings > Personal access tokens, crie um token **com permissão só de Gists (leitura e escrita)** e sem outras permissões.
3. Crie o arquivo `.fst-link.json` na sua pasta de usuário (`C:\Users\SEU-NOME\.fst-link.json`), **fora do projeto**, para o token nunca ir para o GitHub:

```json
{ "token": "github_pat_..." }
```

4. Publique uma versão nova do app (veja o README do app desktop).

Quem entra **pelo navegador** continua precisando receber o link. O app só segue links `https://....trycloudflare.com`; o host, que usa `http://localhost:3000`, nunca é redirecionado.

**Segurança do app desktop:** qualquer pessoa consegue abrir um túnel `trycloudflare.com`, então o app só confia no **link que veio do gist**, no link padrão do app (`server-default.json`), no link aberto pela linha de comando (`FST-Desktop.bat https://...`) e no `localhost` do host. Só nesses endereços o app entrega o login lembrado, libera o microfone e a tela, e responde às funções do desktop (push to talk global, bandeja, atualização, aceleração de hardware). Um endereço digitado em **Trocar servidor** abre só como um site comum (e o app avisa). Se você usa um **link fixo** (por exemplo Tailscale), coloque-o em `"url"` no `server-default.json` e publique uma versão nova do app. Para escolher a tecla do push to talk, o FST precisa estar em foco (a escolha espera até 15 segundos). As regras ficam em `desktop/trust-core.js`, com testes (`cd desktop && npm test`).


## Canais

- **Canal de texto `# FST`:** só texto e imagens (botão de imagem ou Ctrl+V). Guarda as últimas 30 mensagens da sala.
- **Canais de voz:** `ENTRADA`, `RUST`, `DOTA`, `FST OFICIAL` e `AFK`. Todo mundo que abre o app começa **fora dos canais** (internamente a ENTRADA, que não aparece na lista): **ninguém fala nem ouve lá** (microfone e áudio travados, sem transmissão de tela), dá só para ver quem está em cada canal e usar o chat de texto. Clique em um canal para entrar nele. Você só ouve e só se conecta com quem está no mesmo canal.
- **Mover pessoas:** arraste a pessoa (ou você mesmo) com o mouse até o canal de destino. Qualquer um da sala pode mover qualquer um, e a pessoa movida recebe um aviso. Não funciona por toque no celular (lá, só dá para trocar você mesmo de canal).
- **Limites:** até 6 pessoas por canal de voz (RUST, DOTA, FST OFICIAL) e 12 na sala. Trocar de canal encerra a sua transmissão de tela.
- **AFK:** depois de **2 horas sem emitir som no microfone** a pessoa é movida para o AFK, onde o microfone e o áudio ficam totalmente desligados (os botões ficam travados) até ela entrar em outro canal. Só conta o **som do microfone**: mexer no mouse ou teclado não evita o AFK. Quem está transmitindo a tela não é movido. Com o microfone mutado ou o push to talk fechado também não há som, então vale o mesmo prazo.

## Atualizações automáticas (você hospeda no seu PC)

O app de todo mundo (navegador ou FST Desktop) só abre a página que **o seu servidor serve**, então quando você edita os arquivos da pasta `public` (`index.html`, `app.js`, `style.css`...) a galera recebe a mudança sozinha:

- Cada app consulta o servidor a cada 30 segundos. Se achar uma versão nova, quem está **parado** (fora de canal de voz, sem transmitir e sem texto digitado) recarrega sozinho; quem está **em chamada** vê um aviso azul no topo com **Atualizar agora** e recarrega assim que ficar parado.
- Não precisa reiniciar o servidor para isso, nem mandar nada para ninguém.
- Mexeu no `server.js`? Abra o servidor com `INICIAR-SERVIDOR.bat` (usa `node --watch`): ele reinicia sozinho ao salvar. Todos caem por alguns segundos e reconectam.
- **O que NÃO se atualiza sozinho:** a "casca" do FST Desktop (pasta `desktop`: `main.js`, `preload.js`, `ptt-core.js`, `picker.html`, `connect.html`). Se mudar algum deles, mande a pasta `desktop` de novo para a galera substituir (por isso, prefira colocar as novidades na página e deixe a casca quieta).
- **Link fixo:** o link `trycloudflare.com` muda toda vez que o túnel reinicia, e o app desktop guarda o endereço. Para o endereço nunca mudar, use um link fixo, por exemplo o **Tailscale Funnel** (grátis, HTTPS, sem domínio): instale o Tailscale no seu PC, ative o HTTPS/Funnel no painel da sua conta e rode `tailscale funnel --bg 3000`. O endereço `https://seu-pc.seu-tailnet.ts.net` é estável e a galera **não precisa** instalar o Tailscale.

## Contas (e-mail e senha)

Para entrar, cada pessoa **cria uma conta** (nome, e-mail e senha) na tela inicial e depois só faz **Entrar**. O **nome da conta é o nome que aparece na sala** (não dá para trocar na hora de entrar, e dois usuários não podem ter o mesmo nome).

- **Senha:** mínimo de 8 caracteres. Fica guardada só como hash (scrypt com sal) em `data/users.json`, nunca em texto.
- **Sessão:** depois de entrar, o navegador (ou o FST Desktop) fica logado por 30 dias por um cookie `HttpOnly`. O botão **Sair da conta** fica na tela de entrada da sala. As sessões ficam em `data/sessions.json`.
- **Proteção contra tentativas:** 8 senhas erradas seguidas para o mesmo e-mail (ou 20 do mesmo endereço) bloqueiam o login por 10 minutos.
- **Código de convite (opcional):** para que só quem você chamou consiga criar conta, inicie com `INVITE_CODE=palavra-secreta npm start` (no Windows: `set INVITE_CODE=...` antes do `npm start`). A pessoa digita o código na hora de criar a conta.
- **Banimento:** agora vale também pelo **e-mail** da conta, além do endereço de internet e do navegador.
- **Administrador:** continua como antes (botão **Entrar como administrador**), mas é preciso estar logado numa conta primeiro.
- **Esqueci a senha:** ainda não há recuperação por e-mail (o servidor não envia e-mails). O administrador redefine pelo painel (aba **Contas**, botão **Redefinir senha**): o servidor cria uma senha nova e mostra uma vez para você passar à pessoa.
- Se hospedar em Render/Railway, a pasta `data` some a cada deploy: contas e sessões também. Use um disco persistente ou `DATA_DIR`.

## Administrador

Quem entra normalmente continua como sempre. Só o **administrador** pode **mover outras pessoas de canal** (arrastando) e usar as ferramentas abaixo. Cada um continua podendo trocar a si mesmo de canal.

- **Entrar como administrador:** na tela de entrada, clique em **Entrar como administrador**, preencha usuário e senha e entre. Quem errar a senha **não entra** (nem como usuário comum), e 5 erros seguidos bloqueiam aquele endereço por 10 minutos.
- **Qual é a senha:** na **primeira vez** que o servidor inicia, ele cria uma senha aleatória e mostra **uma única vez** no console (`Usuário: admin`). Ela fica guardada só como hash em `data/admin.json`. Para escolher a sua, inicie com `ADMIN_USER=seu_usuario ADMIN_PASS=sua_senha npm start` (no Windows: `set ADMIN_USER=...` e `set ADMIN_PASS=...` antes do `npm start`). Para gerar outra, apague `data/admin.json`.
- **Expulsar / banir:** clique com o botão direito na pessoa da lista (ou toque e segure no celular) e escolha **Expulsar da sala** ou **Banir…**. Expulso pode entrar de novo; banido não. Administradores não podem ser expulsos nem banidos.
- **Painel de administração:** o botão de escudo na barra de cima (só o admin vê) abre o painel, com cinco abas:
  - **Online:** quem está na sala agora (canal, tempo online, mic fechado, ao vivo). Atualiza sozinho. Cada pessoa tem **Silenciar**, **Suspender…**, **Expulsar** e **Banir…**.
  - **Contas:** todas as contas, com busca por nome ou e-mail e o estado de cada uma (online, silenciada, suspensa). Dá para **Silenciar**, **Suspender…**, **Redefinir senha** e **Apagar conta** mesmo com a pessoa offline.
  - **Punições:** quem está suspenso (**Liberar agora**), silenciado (**Tirar silêncio**) e banido (**Desbanir**).
  - **Sala:** **aviso para a sala** (faixa no topo da tela de todo mundo, some em 1 minuto e fica no chat) e **Limpar o chat**.
  - **Registro:** as últimas ações de administração (quem fez o quê e quando), até 500, em `data/audit.json`. Inclui logins de admin e senhas de admin erradas.
- **Silenciar para todos:** o microfone da pessoa é bloqueado (ela não consegue abrir nem pelo push to talk) e os outros aparelhos deixam de tocar a voz e o som de tela dela. Continua valendo se ela recarregar a página ou entrar de novo (fica em `data/smutes.json`) até você tirar o silêncio. Também dá pela lista de canais: botão direito na pessoa.
- **Expulsão por tempo:** de 1 minuto a 7 dias. A pessoa é desconectada na hora, e ao tentar entrar vê até quando está suspensa. Vale pela **conta e pelo aparelho** (criar outra conta no mesmo navegador não burla) e acaba sozinha (`data/suspensions.json`).
- **Apagar mensagens do chat:** o administrador vê um **✕** ao passar o mouse sobre cada mensagem (no celular ele já aparece) e a mensagem some para todo mundo. **Limpar o chat** fica na aba Sala.
- **Redefinir senha:** o servidor gera uma senha aleatória de 12 caracteres, mostra **uma única vez** na tela do admin (nunca vai para o registro), derruba as sessões da pessoa e a desconecta. A pessoa entra com essa senha (ainda não existe tela para ela trocar a própria senha).
- **Apagar conta:** remove login, sessões, foto e configurações da pessoa e a desconecta. Não dá para desfazer; ela pode criar uma conta nova. Banimentos continuam valendo. Você não consegue apagar nem redefinir a conta que está usando.
- **Quem não é alvo:** administradores conectados não podem ser silenciados, suspensos, expulsos nem banidos.
- **Como o banimento funciona:** vale pelo **endereço de internet e por este navegador**, e fica salvo em `data/bans.json` (sobrevive a reinício). Quem divide a internet com outra pessoa (mesma casa) é banido junto, e quem troca de rede e limpa os dados do navegador consegue voltar. Se hospedar em Render/Railway, a pasta `data` some a cada novo deploy (use um disco persistente ou `DATA_DIR`).
- **Use HTTPS** (o link do túnel já é): a senha viaja pela conexão, então fora do HTTPS ela não fica protegida.

## Ouvir YouTube junto

No botão de **nota musical** (ao lado da engrenagem, na barra de baixo), cole o link de um vídeo do YouTube e clique em **Adicionar à fila** (ou aperte Enter). Se nada está tocando, o vídeo começa na hora para todo o canal; se já tem um vídeo, o novo entra no fim da **fila** e toca quando o anterior terminar. **Tocar agora** troca o vídeo atual (a fila continua).

- **Fila:** até 30 vídeos por canal. A lista aparece no mesmo painel, com o nome de quem adicionou e um **×** para tirar da fila. Qualquer pessoa do canal pode adicionar, tirar ou pular.
- **Pular:** o botão de **próximo** no mini-player (aparece quando há fila) toca o próximo vídeo para todos. Se um vídeo não puder ser tocado (removido, privado ou bloqueado pelo dono), o FST pula sozinho para o próximo.
- **Parar para todos** (quadrado) encerra o vídeo e esvazia a fila. A fila é guardada na memória do servidor: se o servidor reiniciar ou o canal ficar vazio, ela some.

- **Cada um toca no próprio navegador** (player do YouTube). O servidor não recebe nem repassa áudio ou vídeo: só sincroniza qual vídeo, play/pausa e a posição.
- **Qualquer pessoa do canal** pode tocar, pausar, pular (barra de posição), trocar o vídeo ou parar para todos.
- **O volume é de cada um:** o controle do mini-player e o mudo valem só para você. Desativar o áudio (botão do fone) também cala o YouTube.
- **Esconder o vídeo** (ícone do olho) deixa só os controles e o som continua.
- Quem entra no canal com um vídeo tocando começa já na posição certa. A cada 20 segundos o player confere a posição com o canal e corrige diferenças.
- Funciona nos canais RUST, DOTA e FST OFICIAL (na ENTRADA e no AFK não). Trocar de canal troca o que você está ouvindo; o canal que fica vazio perde o vídeo.
- Alguns vídeos não podem ser tocados fora do YouTube (o dono bloqueia); aparece um aviso. Se o navegador bloquear o som automático, aparece **Toque para ouvir**. Precisa de internet para carregar o player do YouTube.

## Assistir e parar de assistir

Quando alguém compartilha a tela, os outros veem um cartão **Assistir** no palco. O vídeo só é enviado para quem clicar; para sair, use **Parar de assistir** (canto superior esquerdo do vídeo). Quem transmite vê quantas pessoas estão assistindo, e como cada espectador recebe uma cópia direta, quem não assiste não gasta o upload de quem transmite.

## Push to talk (apertar para falar)

Clique na **engrenagem** ao lado do microfone (seção **Push to talk**) e em **Tecla** para escolher o atalho (escolher a tecla já liga o push to talk sozinho; o interruptor **Apertar para falar** serve para desligar e ligar de novo): pode ser uma tecla (padrão: **V**) ou um **botão do mouse** (meio, laterais "voltar/avançar" etc. — o botão esquerdo não é aceito). O microfone fica mudo e só abre enquanto você segura o atalho ou o botão do microfone (funciona também no celular). A escolha fica salva. No painel, a linha **"Microfone agora: ABERTO/FECHADO"** mostra na hora o que está sendo enviado.

### Em outro programa (jogo etc.): use o FST Desktop

**No navegador o atalho só funciona com a aba do FST aberta e em foco.** Isso é uma regra dos navegadores: nenhuma página web recebe teclas ou cliques de outros programas. Para o push to talk funcionar com o jogo (ou qualquer outro app) em foco, abra o FST pelo app desktop:

- **Windows:** dê dois cliques em `FST-Desktop.bat` (na primeira vez ele instala tudo; precisa do Node.js). Para abrir já no link: `FST-Desktop.bat https://seu-link.trycloudflare.com`
- **Mac/Linux:** `cd desktop && npm install && npm start` (ou `npm start -- https://seu-link.trycloudflare.com`)

Na primeira vez ele pede o endereço do servidor (quem hospeda usa `http://localhost:3000`; quem entra usa o link https do host). Depois abra o painel do push to talk: se aparecer **"Atalho global ativo"** em verde, está funcionando. Se aparecer em vermelho que o atalho não iniciou, a mensagem diz o motivo.

Notas:

- A tecla/botão continua chegando ao jogo (o hook só escuta). Prefira um botão lateral do mouse ou uma tecla que o jogo não use.
- **Windows:** se o jogo roda como administrador, abra o FST Desktop também como administrador, senão o Windows não entrega as teclas/cliques desse jogo. Se mesmo assim a tecla soltar sem aviso, o microfone fecha sozinho em poucos segundos.
- **macOS:** libere o app em Ajustes > Privacidade e Segurança > Monitoramento de Entrada / Acessibilidade.
- **Linux:** funciona em X11; Wayland não permite hook global.
- O app desktop só repassa à página o "apertou/soltou" do atalho escolhido; as outras teclas que você digita no computador nunca saem do app.
- Ao compartilhar tela no app desktop abre uma janela com duas abas: **Tela inteira** (tudo do monitor) e **Um programa** (só aquela janela). O som do sistema vai junto nos dois casos (Windows).
- **Overlay do jogo (Shift+Tab da Steam):** automático ao compartilhar **um programa**. O overlay é desenhado dentro do jogo e não dá para separá-lo da captura; ao apertar Shift+Tab a galera passa a ver a última imagem do jogo (congelada) até você apertar de novo ou Esc. Na **tela inteira** nada disso acontece.
- Quem só assiste/fala sem PTT global pode continuar usando o navegador normalmente.

### "O ícone de gravação continua aceso com o push to talk ligado"

É normal. Com o push to talk ligado o aparelho do microfone continua ligado (isso é o que faz o ícone do Windows/Chrome ficar aceso e permite abrir sem atraso quando você aperta a tecla), mas **enquanto você não segura o atalho só vai silêncio** para os amigos. Para conferir, olhe a linha "Microfone agora" no painel do push to talk.

### Testes

O núcleo do atalho global tem testes que rodam sem Electron: `cd desktop && node ptt-core.test.js`.

## Qualidade do microfone e redução de ruído

No painel da **engrenagem** (seções **Voz** e **Microfone**):

- **Redução de ruído:** sempre por **IA (RNNoise)**, ligada sozinha ao entrar (rede neural leve em WebAssembly, roda no seu PC, sem enviar áudio a ninguém, no estilo do Krisp). Remove teclado, ventilador e ruído constante. Se o navegador não suportar, usa a redução automática dele.
- **Qualidade da voz:** Normal (32 kbps), Alta (64 kbps, padrão) ou Máxima (128 kbps). As duas opções valem ao vivo, sem reconectar, e ficam salvas.
- O microfone também usa cancelamento de eco, ganho automático e 48 kHz mono.

## Desativar áudio

O botão de **fone de ouvido**, ao lado do microfone, para de tocar todo o áudio da sala (vozes e som das telas compartilhadas) **e fecha o seu microfone**. Clicando de novo, o áudio volta e o microfone retorna ao que era antes (mutado, aberto ou em push to talk). Clicar no botão do microfone com o áudio desativado também reativa os dois, como no Discord. Com o áudio desativado, o push to talk não abre o microfone.

Todo mundo na sala vê, ao lado do seu nome na lista, um ícone de **microfone riscado** (mutado ou sem microfone) ou de **fone riscado** (áudio desativado). No push to talk o microfone fechado é o normal, então não aparece ícone.

## Qualidade da transmissão

No botão de ajustes (ícone de controles) ao lado de **Compartilhar tela** ficam as opções da transmissão:

| Opção | Valores | Bitrate máx. por espectador |
|---|---|---|
| Qualidade | 1080p 60 / 1080p 30 / 720p 60 / 720p 30 / 480p 30 / 360p 30 | ~10 / 6 / 6 / 3 / 1,5 / 0,8 Mbps |
| Modo | **Fluidez** (mantém os fps, ideal p/ jogos) ou **Nitidez** (mantém a resolução, ideal p/ texto, slides, código) | — |
| Codec | automático, H.264 (leve, usa a placa de vídeo), VP9 (mais nítido), AV1 (melhor, mas pesa no processador) | — |

- A **qualidade e o modo podem ser trocados com a transmissão ao vivo**. O codec só antes de começar.
- Se a tela for maior que a qualidade escolhida (monitor 1440p/4K), ela é reduzida para a altura escolhida. A imagem nunca é ampliada. Se travar, baixe a qualidade (dá para trocar ao vivo).
- O som do sistema é enviado sem cancelamento de eco/ruído (música e jogos soam melhor) a até 192 kbps.
- Em jogos, **H.264** costuma ser o melhor: o vídeo é codificado pela placa de vídeo e quase não tira fps do jogo. VP9/AV1 gastam CPU.
- Use **Chrome ou Edge** para transmitir. Quem assiste pode usar qualquer navegador moderno.
- Ao compartilhar, marque "Compartilhar áudio" na janela do navegador (no app desktop do Windows o som do sistema é enviado automaticamente).
- Cada espectador recebe uma cópia direta do seu PC: com 1080p60 e 3 amigos são ~30 Mbps de **upload**. Se a internet não aguentar, baixe a qualidade (dá para trocar ao vivo).
- No canto de cada transmissão aparece a resolução e os FPS reais recebidos.
- Duplo clique no vídeo = tela cheia. Limite de 6 pessoas por sala.

## Se alguém não conectar (NAT/4G)

Alguns tipos de rede bloqueiam a conexão direta. Aí é preciso um servidor TURN (ex.: [coturn](https://github.com/coturn/coturn) ou um serviço como Metered/Twilio). Configure ao iniciar:

```bash
TURN_URL=turn:seu.servidor:3478 TURN_USER=usuario TURN_PASS=senha npm start
```
