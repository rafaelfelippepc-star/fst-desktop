# FST Desktop

App do FST para Windows com **push to talk global** (funciona com o jogo em foco) e compartilhamento de tela com som do sistema. Ele se atualiza sozinho.

## Instalar (para quem vai usar)

1. Abra a aba **Releases** deste repositório (lado direito da página) e baixe o `FST-Setup-x.y.z.exe` da versão mais recente.
2. Execute. Se o Windows mostrar "O Windows protegeu seu computador", clique em **Mais informações** e depois em **Executar assim mesmo** (o app não tem assinatura paga, só isso).
3. Na primeira vez, se o app pedir o endereço do servidor, cole o link que o host mandou.

Depois é só abrir o FST pelo atalho. Quando sair versão nova, ele baixa sozinho e avisa; é só clicar em **Reiniciar agora** (ou fechar o app, que instala na saída). No menu **FST** há **Procurar atualizações**.

O servidor fica no PC do host: se ele estiver desligado, o app mostra um aviso de que não conseguiu conectar.

## Publicar uma versão nova (para o host)

1. Edite os arquivos e salve.
2. Envie para o GitHub e crie uma tag com o número da versão:

```bash
git add .
git commit -m "o que mudou"
git push
git tag v1.0.1
git push origin v1.0.1
```

3. Abra a aba **Actions**: o job "Publicar versão" gera o instalador e cria a Release (leva uns 3 a 6 minutos). Quando terminar, os apps instalados recebem a atualização sozinhos (eles conferem ao abrir e a cada 4 horas).

O número da versão vem da tag: use sempre um número maior que o anterior (v1.0.1, v1.0.2, v1.1.0...).

Mudanças na **página** do FST (o que aparece dentro do app) **não precisam** desta etapa: elas vêm do seu servidor e se atualizam sozinhas. Aqui só entram mudanças do app em si (`main.js`, `preload.js`, `ptt-core.js`, `picker.html`, `connect.html`).

## Rodar sem instalar (para testar)

```bash
npm install
npm start            # ou: npm start -- https://seu-link
npm test             # testes do push to talk
```

Nesse modo a atualização automática fica desligada (ela só existe no app instalado).
