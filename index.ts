import { CopilotClient } from "@github/copilot-sdk";
import * as readline from "readline";

const MODEL = "gpt-4.1";
const DEFAULT_TURNS = 6;

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function sendAndCollect(
  session: Awaited<ReturnType<InstanceType<typeof CopilotClient>["createSession"]>>,
  prompt: string,
  label: string
): Promise<string> {
  process.stdout.write(`\n${label}: `);

  let reply = "";

  const done = new Promise<void>((resolve) => {
    const unsubDelta = session.on("assistant.message_delta", (event) => {
      process.stdout.write(event.data.deltaContent);
      reply += event.data.deltaContent;
    });

    const unsubIdle = session.on("session.idle", () => {
      process.stdout.write("\n");
      unsubDelta();
      unsubIdle();
      resolve();
    });
  });

  await session.send({ prompt });
  await done;

  return reply;
}

async function main() {
  const topic = await ask("会話のテーマ／最初のメッセージを入力してください: ");
  if (!topic) {
    console.error("テーマが入力されませんでした。");
    process.exit(1);
  }

  const turnsInput = await ask(`会話のターン数を入力してください (デフォルト: ${DEFAULT_TURNS}): `);
  const turns = parseInt(turnsInput) || DEFAULT_TURNS;

  console.log(`\n=== Copilot 同士の会話 (モデル: ${MODEL}, ${turns}ターン) ===\n`);

  const client = new CopilotClient();
  await client.start();

  const permissionHandler = async () => ({ kind: "approved" as const });

  const sessionA = await client.createSession({
    model: MODEL,
    streaming: true,
    systemMessage: {
      mode: "replace",
      content:
        "You are Copilot A, an AI assistant engaged in a lively intellectual conversation with another AI called Copilot B. " +
        "Respond thoughtfully, build on the other's points, and keep each reply to 2–4 sentences.",
    },
    onPermissionRequest: permissionHandler,
  });

  const sessionB = await client.createSession({
    model: MODEL,
    streaming: true,
    systemMessage: {
      mode: "replace",
      content:
        "You are Copilot B, an AI assistant engaged in a lively intellectual conversation with another AI called Copilot A. " +
        "Respond thoughtfully, build on the other's points, and keep each reply to 2–4 sentences.",
    },
    onPermissionRequest: permissionHandler,
  });

  process.on("SIGINT", async () => {
    console.log("\n\n会話を終了します。");
    await sessionA.destroy();
    await sessionB.destroy();
    await client.stop();
    process.exit(0);
  });

  let currentMessage = topic;

  for (let i = 0; i < turns; i++) {
    const isATurn = i % 2 === 0;

    if (isATurn) {
      currentMessage = await sendAndCollect(sessionA, currentMessage, "Copilot A");
    } else {
      currentMessage = await sendAndCollect(sessionB, currentMessage, "Copilot B");
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n=== 会話終了 ===");

  await sessionA.destroy();
  await sessionB.destroy();
  await client.stop();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
