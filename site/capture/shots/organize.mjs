export default [
  {
    id: "tools/organize/name-groups",
    kind: "still",
    route: "/organize?path=%2Fmedia%2Forganize-sandbox%2FInbox",
    alt: "Organize listing an unsorted folder, with common-name chips and one-click smart selection by file type.",
    waitFor: [/common names/i, /Holiday 2023/],
    crop: { rect: { x: 240, y: 425, width: 1184, height: 290 } },
  },
];
