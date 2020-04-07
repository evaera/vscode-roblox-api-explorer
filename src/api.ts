import fetch from "node-fetch"
import * as xml2js from "xml2js"

const CURRENT_VERSION_URL =
  "https://clientsettings.roblox.com/v1/client-version/WindowsStudio"
const API_DUMP_URL =
  "https://s3.amazonaws.com/setup.roblox.com/{version}-API-Dump.json"
const REFLECTION_METADATA_URL =
  "https://raw.githubusercontent.com/CloneTrooper1019/Roblox-Client-Tracker/roblox/ReflectionMetadata.xml"

async function getJson(url: string) {
  return fetch(url).then((r) => r.json())
}

async function injectDescriptions(classes: Array<any>) {
  const rmd = await xml2js.parseStringPromise(
    await fetch(REFLECTION_METADATA_URL).then((r) => r.text())
  )

  for (const classEntry of classes) {
    const entry = rmd.roblox.Item.find(
      (i: any) => i.$.class === "ReflectionMetadataClasses"
    ).Item.find((i: any) =>
      i.Properties[0].string.find(
        (p: any) => p.$.name === "Name" && p._ === classEntry.Name
      )
    )

    const summary = entry?.Properties[0].string.find(
      (s: any) => s.$.name === "summary"
    )?._

    if (entry && entry.Item) {
      const items = Object.fromEntries(
        entry.Item.flatMap((i: any) => i.Item)
          .filter((i: any) => i && i.Properties !== undefined)
          .map((i: any) => [
            i.Properties[0].string.find((s: any) => s.$.name === "Name")?._,
            i.Properties[0].string.find((s: any) => s.$.name === "summary")?._,
          ])
          .filter((entry: any) => entry.length === 2)
      )

      for (const member of classEntry.Members) {
        if (items[member.Name]) {
          member.__summary = items[member.Name]
        }
      }
    }

    classEntry.__summary = summary
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

  await injectDescriptions(dump.Classes).catch(console.error)

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
  ]
}

let apiPromise: Promise<Array<any>>
export function getApi(): Promise<Array<any>> {
  if (!apiPromise) {
    apiPromise = getApiAsync()
  }

  return apiPromise
}
