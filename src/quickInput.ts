import * as vscode from "vscode";
import {
  type Asker,
  back,
  type Choices,
  type Placed,
  type Reply,
} from "./adding";

// Show a quick input until it's answered, gone back from or hidden, with a
// Back button after the first step. It's kept when focus moves elsewhere.
// Disposing it disposes its listeners.
function show<T>(
  input: vscode.InputBox | vscode.QuickPick<vscode.QuickPickItem>,
  title: string,
  { step, total }: Placed,
  listen: (settle: (reply: Reply<T>) => void) => void,
): Promise<Reply<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (reply: Reply<T>) => {
      if (!settled) {
        settled = true;
        resolve(reply);
        input.dispose();
      }
    };
    input.title = title;
    input.step = step;
    input.totalSteps = total;
    input.ignoreFocusOut = true;
    input.buttons = step > 1 ? [vscode.QuickInputButtons.Back] : [];
    listen(settle);
    input.onDidTriggerButton((button) => {
      if (button === vscode.QuickInputButtons.Back) {
        settle(back);
      }
    });
    input.onDidHide(() => settle(undefined));
    input.show();
  });
}

// Ask a flow's questions with VS Code's quick input, titled as given
export function quickInput(title: string): Asker {
  const pick = <T>(
    question: Choices & Placed,
    many: boolean,
    answer: (ids: string[]) => T,
  ) => {
    const list = vscode.window.createQuickPick<
      vscode.QuickPickItem & { id: string }
    >();
    list.placeholder = question.placeholder;
    list.items = question.choices;
    list.canSelectMany = many;
    const before = list.items.filter((item) =>
      (question.chosen ?? []).includes(item.id),
    );
    if (many) {
      list.selectedItems = before;
    } else if (before.length > 0) {
      list.activeItems = before;
    }
    return show<T>(list, title, question, (settle) => {
      list.onDidAccept(() => {
        const ids = (many ? list.selectedItems : list.activeItems).map(
          (item) => item.id,
        );
        if (many || ids.length > 0) {
          settle(answer(ids));
        }
      });
    });
  };
  return {
    input: (question) => {
      const box = vscode.window.createInputBox();
      box.prompt = question.prompt;
      box.placeholder = question.placeholder;
      box.value = question.value ?? "";
      box.password = question.password ?? false;
      const check = () => {
        box.validationMessage = question.validate?.(box.value);
        return box.validationMessage === undefined;
      };
      return show<string>(box, title, question, (settle) => {
        box.onDidChangeValue(check);
        box.onDidAccept(() => {
          if (check()) {
            settle(box.value);
          }
        });
      });
    },
    pick: (question) => pick(question, false, ([id]) => id),
    tick: (question) => pick(question, true, (ids) => ids),
  };
}
