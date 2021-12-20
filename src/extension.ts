// This code written with the following philosophy: "Worse is better"

import * as vscode from "vscode"
import { getApi } from "./api"

const memberTypeIcons: { [index: string]: string } = {
  Event: "symbol-event",
  Property: "symbol-field",
  Function: "symbol-function",
}

const tagIcons: { [index: string]: string } = {
  Service: "symbol-misc",
  Enum: "symbol-enum",
  EnumItem: "symbol-enum-member",
  DataType: "symbol-interface",
  Library: "symbol-module",
}

function getIcon(member: any) {
  for (const tag of member.Tags) {
    if (tagIcons[tag]) {
      return tagIcons[tag]
    }
  }

  if (memberTypeIcons[member.MemberType]) {
    return memberTypeIcons[member.MemberType]
  } else {
    return "symbol-class"
  }
}

function getInputItem(
  member: any,
  showDetail: boolean | string,
  trigger?: (state: State) => void
) {
  if (member.Tags.includes("EnumItem")) {
    showDetail = false
  }

  return {
    label: `$(${getIcon(member)}) ${member.Name}`,
    description: [
      (member.ValueType && member.ValueType.Name) ||
        (member.ReturnType && member.ReturnType.Name),
      member.Tags.length > 0 && member.Tags.join(", "),
    ]
      .filter((x) => !!x)
      .join(" | "),
    member: member,
    detail: showDetail
      ? member.__summary ||
        (typeof showDetail === "string" ? showDetail : false) ||
        "No description available."
      : undefined,
    trigger,
  }
}

const memberHasTag = (tag: string) => (member: any) =>
  member.Tags ? member.Tags.includes(tag) : false

const identity = <T>(value: T) => value

const doesMemberMatch = (text: string) => (member: any) =>
  member.Name.toLowerCase().includes(text.toLowerCase())

function filterInherited(groups: any, filterFn: (i: any) => boolean) {
  const result = []

  for (const group of groups) {
    const filtered = group.members.filter(filterFn)

    if (filtered.length > 0) {
      result.push({
        from: group.from,
        members: filtered,
      })
    }
  }

  return result
}

function stateAwareFilter(state: State): (member: any) => boolean {
  return (member) =>
    !!(state.saved.deprecated
      ? identity
      : !memberHasTag("Deprecated")(member)) &&
    !!(state.saved.hidden ? identity : !memberHasTag("Hidden")(member)) &&
    !!(state.saved.robloxSecurity
      ? identity
      : !memberHasTag("RobloxScriptSecurity")(member)) &&
    !!(state.saved.pluginSecurity
      ? identity
      : !memberHasTag("PluginSecurity")(member)) &&
    doesMemberMatch(state.scope.searchText)(member)
}

const typeIcons: { [index: string]: string } = {
  string: "symbol-string",
  number: "symbol-number",
  bool: "symbol-boolean",
  Variant: "symbol-misc",
  Tuple: "symbol-value",
}
function iconFromType(name: string) {
  if (typeIcons[name]) {
    return typeIcons[name]
  }

  return "symbol-variable"
}

const Scopes: { [index: string]: Scope } = {
  detail: {
    searchText: "",
    placeholderText: "Filter...",

    getItems(state) {
      if (!this.focus) {
        return []
      }

      return [
        {
          label: "$(discard) Back",
          trigger(state: State) {
            if (Scopes.instance.focus) {
              state.scope = Scopes.instance
            } else {
              state.scope = Scopes.list
            }
          },
        },
        ...(this.focus.__link
          ? [
              {
                label: "$(link-external) Open DevHub Documentation",
                trigger: () => {
                  vscode.env.openExternal(vscode.Uri.parse(this.focus.__link))
                },
              },
            ]
          : [
              {
                label: "$(link-external) Open DevHub Documentation",
                trigger: () => {
                  vscode.env.openExternal(
                    vscode.Uri.parse(
                      "https://developer.roblox.com/en-us/api-reference/" +
                        (this.focus.MemberType
                          ? `${this.focus.MemberType.toLowerCase()}/${
                              this.focus.of
                            }/${this.focus.Name}`
                          : `${
                              this.focus.Tags.includes("Enum")
                                ? "enum"
                                : "class"
                            }/${this.focus.Name}`)
                    )
                  )
                },
              },
              {
                label: "$(link-external) Open Roblox API Reference",
                trigger: () => {
                  vscode.env.openExternal(
                    vscode.Uri.parse(
                      `https://robloxapi.github.io/ref/${
                        this.focus.Tags.includes("Enum") ? "enum" : "class"
                      }/` +
                        (this.focus.MemberType
                          ? `${this.focus.of}#member-${this.focus.Name}`
                          : `/${this.focus.Name}`)
                    )
                  )
                },
              },
            ]),
        {
          label: "$(clippy) Copy Name to Clipboard",
          trigger: () => {
            vscode.env.clipboard.writeText(this.focus.Name)
          },
        },
        getInputItem(this.focus, true),
        ...(this.focus.Parameters
          ? [
              {
                label: `― Params ―`,
              },
              ...this.focus.Parameters.map((param: any) => ({
                label: `$(${iconFromType(param.Type.Name)}) ${param.Name}`,
                description: param.Type.Name,
              })),
            ]
          : []),
        ...(this.focus.ReturnType
          ? [
              {
                label: `― Returns ―`,
              },
              {
                label: `$(${iconFromType(this.focus.ReturnType.Name)}) ${
                  this.focus.ReturnType.Name
                }`,
              },
            ]
          : []),
      ]
    },
  },
  instance: {
    searchText: "",
    placeholderText: "Enter a member name...",

    getItems(state) {
      if (!this.focus) {
        return []
      }

      const inherited = filterInherited(
        this.focus.__inheritedMembers,
        stateAwareFilter(state)
      )

      const getTrigger = (member: any) => () => {
        if (member.Tags.includes("EnumItem")) {
          return
        }
        state.scope = Scopes.detail
        state.scope.focus = member
      }

      return [
        {
          label: "$(discard) Back",
          trigger(state: State) {
            Scopes.instance.focus = undefined
            state.scope = Scopes.list
          },
        },
        getInputItem(this.focus, true, getTrigger(this.focus)),
        ...this.focus.Members.filter(
          stateAwareFilter(state)
        ).map((member: any) => getInputItem(member, true, getTrigger(member))),
        ...(state.saved.inherited && inherited.length > 0
          ? [
              ...inherited.flatMap((group) => [
                ...(this.searchText.length === 0
                  ? [
                      {
                        label: `― Inherited from ${group.from} ―`,
                      },
                    ]
                  : []),
                ...group.members.map((member: any) =>
                  getInputItem(member, true, getTrigger(member))
                ),
              ]),
            ]
          : []),
      ]
    },
  },
  list: {
    searchText: "",

    getItems(state) {
      return state.api
        .filter((member: any) =>
          state.saved.filter === "enums"
            ? member.Tags.includes("Enum")
            : state.saved.filter === "classes"
            ? member.MemoryCategory === "Instances"
            : state.saved.filter === "datatypes"
            ? member.Tags.includes("DataType")
            : state.saved.filter === "libraries"
            ? member.Tags.includes("Library")
            : state.saved.filter === "globals"
            ? member.Tags.includes("Global")
            : true
        )
        .filter(stateAwareFilter(state))
        .map((member: any) => ({
          ...getInputItem(member, false, (state: State) => {
            if (member.MemberType) {
              state.scope = Scopes.detail
            } else {
              state.scope = Scopes.instance
            }

            state.scope.focus = member
          }),
        }))
    },
  },
}

interface Scope {
  searchText: string
  focus?: any
  placeholderText?: string

  getItems(state: State): Array<vscode.QuickPickItem>
}

const createToggleButton = <T extends keyof SavedState>(
  state: State,
  field: T,
  getIcon: (state: SavedState[T]) => string,
  getTooltip: (state: SavedState[T]) => string,
  save: () => void,
  states: Array<any> = [true, false]
) => ({
  iconPath: new vscode.ThemeIcon(getIcon(state.saved[field])),
  tooltip: getTooltip(state.saved[field] as any),
  trigger() {
    let changed = false
    for (const [index, value] of states.entries()) {
      if (state.saved[field] === value) {
        state.saved[field] = states[index + 1] ?? states[0]
        changed = true
        break
      }
    }

    // forwards compat
    if (!changed) {
      state.saved[field] = states[0]
    }

    save()
  },
})

function reifyScope(
  input: vscode.QuickPick<any>,
  state: State,
  save: () => void
) {
  input.value = state.scope.searchText
  input.items = state.scope.getItems(state)
  input.title = "Roblox API Explorer"
  input.placeholder = state.scope.placeholderText || "Enter an instance name"

  input.buttons = [
    createToggleButton(
      state,
      "resume",
      (on) => (on ? "window" : "pin"),
      (on) =>
        `Resume window state when re-opening this menu (Currently ${
          on ? "on" : "off"
        })`,
      save
    ),
    createToggleButton(
      state,
      "filter",
      (on) =>
        ({
          all: "filter",
          classes: "symbol-class",
          enums: "symbol-enum",
          libraries: "symbol-module",
          datatypes: "symbol-interface",
          globals: "symbol-function",
        }[on]),
      (on) => `Change filtered view (Currently ${on})`,
      save,
      ["all", "enums", "classes", "libraries", "datatypes", "globals"]
    ),
    createToggleButton(
      state,
      "hidden",
      (on) => (on ? "eye" : "eye-closed"),
      (on) => `Show hidden items (Currently ${on ? "shown" : "hidden"})`,
      save
    ),
    createToggleButton(
      state,
      "deprecated",
      (on) => (on ? "thumbsdown" : "thumbsup"),
      (on) => `Show deprecated items (Currently ${on ? "shown" : "hidden"})`,
      save
    ),
    createToggleButton(
      state,
      "pluginSecurity",
      (on) => (on ? "plug" : "person"),
      (on) => `Show Plugin items (Currently ${on ? "shown" : "hidden"})`,
      save
    ),
    createToggleButton(
      state,
      "robloxSecurity",
      (on) => (on ? "lock" : "unlock"),
      (on) => `Show Roblox-Only items (Currently ${on ? "shown" : "hidden"})`,
      save
    ),
    createToggleButton(
      state,
      "inherited",
      (on) => (on ? "git-branch" : "git-commit"),
      (on) => `Show inherited items (Currently ${on ? "shown" : "hidden"})`,
      save
    ),
  ] as any
}

interface SavedState {
  deprecated: boolean
  inherited: boolean
  hidden: boolean
  robloxSecurity: boolean
  pluginSecurity: boolean
  resume: boolean
  filter: "enums" | "classes" | "all" | "datatypes" | "libraries" | "globals"
}
interface State {
  api: any
  scope: Scope
  saved: SavedState
}

let lastState: State
export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "roblox-api-explorer.open",
    async () => {
      try {
        const input = vscode.window.createQuickPick()

        input.title = "Roblox API Explorer [Downloading...]"
        input.placeholder = "Enter an instance name"
        input.busy = true
        input.ignoreFocusOut = true

        input.show()

        let api = context.globalState.get("api")

        const apiPromise = getApi()
          .then((newApi) => {
            api = newApi

            input.busy = false
            context.globalState.update("api", api)
          })
          .catch((e) => {
            console.error(e)

            vscode.window.showErrorMessage(
              "Roblox API Explorer: Failed to download new API"
            )
          })

        if (!api) {
          await apiPromise
        }

        const state: State =
          lastState && lastState.saved.resume
            ? lastState
            : {
                api,
                scope: Scopes.list,
                saved: {
                  deprecated: false,
                  inherited: true,
                  hidden: false,
                  pluginSecurity: false,
                  robloxSecurity: false,
                  resume: false,
                  filter: "all",
                  ...context.globalState.get("state", {}),
                },
              }
        lastState = state

        // Restore text in case user started typing early
        state.scope.searchText = input.value

        if (!state.saved.resume) {
          Scopes.instance.searchText = ""
          Scopes.detail.searchText = ""
          Scopes.list.searchText = ""
        }

        const save = () => context.globalState.update("state", state.saved)

        reifyScope(input, state, save)

        input.onDidChangeValue((searchText) => {
          state.scope.searchText = searchText
          reifyScope(input, state, save)
        })

        input.onDidAccept(() => {
          const button = input.activeItems[0] as any

          if (button.trigger) {
            try {
              button.trigger(state)
              reifyScope(input, state, save)
            } catch (e) {
              console.error(e)
            }
          }
        })

        input.onDidTriggerButton((button: any) => {
          if (button.trigger) {
            button.trigger(state)
            reifyScope(input, state, save)
          }
        })
      } catch (e) {
        console.error(e)
      }
    }
  )

  context.subscriptions.push(disposable)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() {}
