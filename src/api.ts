import fetch from "node-fetch"

const CURRENT_VERSION_URL =
  "https://clientsettings.roblox.com/v1/client-version/WindowsStudio"
const API_DUMP_URL =
  "https://s3.amazonaws.com/setup.roblox.com/{version}-API-Dump.json"
const API_DOCS_URL =
  "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/api-docs/en-us.json"

async function getJson(url: string) {
  return fetch(url).then((r) => r.json())
}

function stripHtml(str?: string) {
  if (str == null) return
  return str.replace(/<[^>]*>?/gm, "")
}

function convertDocsFunction(name: string, entry: any, tag?: string) {
  if (entry.overloads) {
    const ty = Object.keys(entry.overloads)[0]

    const match = ty.match(/^\((.*)\) -> (\w+)$/)
    if (match) {
      const params = match[1].split(",")

      entry.params = params.map((paramType, i) => ({
        name: `Parameter ${i}`,
        type: paramType,
      }))

      entry.returns = [
        {
          name: match[2] || "undocumented",
        },
      ]
    } else {
      entry.params = []
      entry.returns = []
    }
  }

  return {
    MemberType: "Function",
    Name: name,
    Parameters: entry.params.map((param: any) => ({
      Name: param.name,
      Type: {
        Category: "Unknown",
        Name: param.type || "undocumented",
      },
    })),
    ReturnType: {
      Category: "Unknown",
      Name:
        entry.returns.length === 1
          ? entry.returns[0].name
          : entry.returns.length > 1
          ? `${entry.returns.length} values`
          : "undocumented",
    },
    Tags: tag ? [tag] : [],
    __summary: stripHtml(entry.documentation),
    __link: entry.learn_more_link,
  }
}

function extractFromDocs(docs: any) {
  const globals = []
  const dataTypes = []

  for (let key in docs) {
    if (key.includes(".")) continue // optimization

    const match = key.match(/^(?:@roblox|@luau)\/global\/(\w+)$/)

    if (match) {
      const name = match[1]
      const entry = docs[key]

      if (entry.params || entry.returns) {
        globals.push(convertDocsFunction(name, entry, "Global"))
      } else if (entry.keys) {
        const members: any[] = Object.entries(entry.keys).map(
          ([memberName, memberKey]: [any, any]) => {
            const memberEntry = docs[memberKey]

            return convertDocsFunction(memberName, memberEntry, "Constructor")
          }
        )

        const globalType = docs[`@roblox/globaltype/${name}`]

        if (globalType) {
          members.push(
            ...Object.entries(globalType.keys).map(
              ([memberName, memberKey]: [any, any]) => {
                const memberEntry = docs[memberKey]

                if (memberEntry.params || memberEntry.returns) {
                  return convertDocsFunction(memberName, memberEntry)
                } else {
                  return {
                    MemberType: "Property",
                    Name: memberName,
                    __summary: stripHtml(memberEntry.documentation),
                    ValueType: {
                      Category: "Unknown",
                      Name: "",
                    },
                    Tags: [],
                    __link: entry.learn_more_link,
                  }
                }
              }
            )
          )
        }

        const isLibrary =
          entry.learn_more_link && entry.learn_more_link.includes("lua-docs") // lol

        dataTypes.push({
          Name: name,
          Members: members,
          __summary: stripHtml(entry.documentation),
          Tags: [isLibrary ? "Library" : "DataType"],
          __inheritedMembers: [],
          __link: entry.learn_more_link,
        })
      }
    }
  }

  return { dataTypes, globals }
}

async function injectDescriptions(classes: Array<any>, docs: any) {
  for (const classEntry of classes) {
    for (const member of classEntry.Members) {
      const entry = docs[`@roblox/globaltype/${classEntry.Name}.${member.Name}`]

      if (entry) {
        member.__summary = stripHtml(entry.documentation)
      }
    }
    const entry = docs[`@roblox/globaltype/${classEntry.Name}`]

    if (entry) {
      classEntry.__summary = stripHtml(entry.documentation)
    }
  }
}

function getInheritedMembers(
  api: Array<any>,
  superClass: string,
  members: Array<any> = []
): Array<any> {
  if (!superClass) {
    return members
  }

  const parent = api.find((member) => member.Name === superClass)

  if (!parent) {
    return members
  }

  let group = members.find((group) => group.from === superClass)
  if (!group) {
    group = {
      members: [],
      from: superClass,
    }
    members.push(group)
  }

  for (const parentMember of parent.Members) {
    if (
      !group.members.find((member: any) => member.Name === parentMember.Name)
    ) {
      group.members.push({ ...parentMember, of: parent.Name })
    }
  }

  return getInheritedMembers(api, parent.Superclass, members)
}

function normalizeTags(member: any) {
  member.Tags = member.Tags || []

  if (member.Tags.includes("Service")) {
    member.Tags = member.Tags.filter((tag: string) => tag !== "NotCreatable")
  }

  if (member.Security) {
    if (typeof member.Security === "object" && member.Security !== null) {
      if (member.Security.Read !== member.Security.Write) {
        member.Tags.push(`Read:${member.Security.Read}`)
        member.Tags.push(`Write:${member.Security.Write}`)
      } else {
        member.Tags.push(member.Security.Read)
      }
    } else {
      member.Tags.push(member.Security)
    }
  }

  member.Tags = member.Tags.filter(
    (tag: string) => !["CustomLuaState", "None"].includes(tag)
  )
}

async function getApiAsync() {
  const versionInfo = await getJson(CURRENT_VERSION_URL)
  const currentVersionId = versionInfo.clientVersionUpload
  const dump = await getJson(
    API_DUMP_URL.replace("{version}", currentVersionId)
  )

  const docs = await getJson(API_DOCS_URL)

  injectDescriptions(dump.Classes, docs)

  for (const classEntry of dump.Classes) {
    classEntry.__inheritedMembers = getInheritedMembers(
      dump.Classes,
      classEntry.Superclass
    )

    normalizeTags(classEntry)
    for (const member of classEntry.Members) {
      member.of = classEntry.Name
      normalizeTags(member)
    }
  }

  console.log(`${dump.Classes.length} classes`)

  const { dataTypes, globals } = extractFromDocs(docs)

  return [
    ...dump.Classes,
    ...dump.Enums.map((item: any) => ({
      Name: item.Name,
      Members: item.Items.map((item: any) => ({
        ...item,
        Tags: ["EnumItem"],
        __summary: "",
      })),
      Tags: ["Enum"],
      __inheritedMembers: [],
    })),
    ...dataTypes,
    ...globals,
  ]
}

let apiPromise: Promise<Array<any>>
export function getApi(): Promise<Array<any>> {
  if (!apiPromise) {
    apiPromise = getApiAsync()
  }

  return apiPromise
}
