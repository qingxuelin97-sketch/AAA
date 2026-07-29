#!/usr/bin/env python3
"""Build a small, reproducible reference dossier from an Android APK.

The APK is read in place.  No decompiler output or complete APK extraction is
written into this repository; the output is metadata, indexes, and the small
allowlisted Lottie samples declared below.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile
from datetime import datetime, timezone
from zipfile import ZipFile

DEFAULT_APK = Path(r"C:\Users\linhy\Downloads\base().apk")
DEFAULT_TOOLS = Path(r"C:\Users\linhy\AppData\Local\Android\Sdk\build-tools\35.0.0")
SELECTED_LOTTIES = {
    "gesture-double-tap.json": "assets/gesture_guide/doubleTap.json",
    "gesture-long-press.json": "assets/gesture_guide/longPress.json",
    "gesture-swipe-left.json": "assets/gesture_guide/swipeLeft.json",
    "gesture-swipe-up.json": "assets/gesture_guide/swipeUp.json",
    "chat-bubble-like.json": "assets/like/chat_bubble_like.json",
    "chat-bubble-dislike.json": "assets/like/chat_bubble_dislike.json",
    "double-tap-like.json": "assets/like/double_tap_like.json",
}
SELECTED_JSON_ASSETS = {
    "chat-item-action-config-default.json": "assets/chat_item_action_config_default.json",
}
SELECTED_LAYOUTS = [
    {"id": "home-bar", "surface": "today", "apkPath": "res/layout/view_new_home_bar.xml"},
    {"id": "home-moments", "surface": "today", "apkPath": "res/layout/home_moments_layout.xml"},
    {"id": "home-feedback", "surface": "today", "apkPath": "res/layout/home_fragment_feed_item_feedback.xml"},
    {"id": "discover-activity", "surface": "discover", "apkPath": "res/layout/search_discover_activity.xml"},
    {"id": "discover-fragment", "surface": "discover", "apkPath": "res/layout/search_discover_fragment.xml"},
    {"id": "discover-header", "surface": "discover", "apkPath": "res/layout/search_discover_header_view.xml"},
    {"id": "discover-item", "surface": "discover", "apkPath": "res/layout/search_discover_item.xml"},
    {"id": "messages-recent-list", "surface": "messages", "apkPath": "res/layout/fragment_recent_chat.xml"},
    {"id": "messages-recent-row", "surface": "messages", "apkPath": "res/layout/list_item_recent_chat.xml"},
    {"id": "chat-activity", "surface": "chat", "apkPath": "res/layout/mxchat_activity_main.xml"},
    {"id": "chat-root", "surface": "chat", "apkPath": "res/layout/chat_max_root_fragment_layout.xml"},
    {"id": "chat-list", "surface": "chat", "apkPath": "res/layout/chat_mx_chat_list_layout.xml"},
    {"id": "chat-im-fragment", "surface": "chat", "apkPath": "res/layout/fragment_main_bot_im.xml"},
    {"id": "member-profile-root", "surface": "profile", "apkPath": "res/layout/user_profile_root_layout.xml"},
    {"id": "member-profile-header", "surface": "profile", "apkPath": "res/layout/user_profile_my_user_info_header_view.xml"},
    {"id": "member-profile-item", "surface": "profile", "apkPath": "res/layout/user_profile_item_jin_gang.xml"},
    {"id": "member-center", "surface": "profile", "apkPath": "res/layout/member_center_layout.xml"},
    {"id": "member-center-active", "surface": "profile", "apkPath": "res/layout/member_center_during_fragment_layout.xml"},
    {"id": "member-center-expired", "surface": "profile", "apkPath": "res/layout/member_center_expire_fragment_layout.xml"},
    {"id": "home-shell-splash", "surface": "shell", "apkPath": "res/layout/home_splash_layout.xml"},
]
TARGET_DEX_CLASSES = {
    "HomeActivity": "com.story.ai.biz.home.ui.HomeActivity",
    "HomeFeedFragment": "com.story.ai.biz.home.homepage.HomeFeedFragment",
    "BotPartnerActivity": "com.story.ai.biz.botpartner.ui.BotPartnerActivity",
    "ChatIMFragment": "com.story.ai.biz.botpartner.ui.creating.ChatIMFragment",
    "StoryGameActivity": "com.story.ai.biz.game_bot.home.StoryGameActivity",
    "DramaActivity": "com.story.ai.biz.drama.detail.DramaActivity",
    "UGCCreationActivity": "com.story.ai.biz.creation.ui.UGCCreationActivity",
    "SearchMainActivity": "com.story.ai.biz.search.ui.SearchMainActivity",
    "MemberCenterActivity": "com.story.ai.commercial.member.membercenter.view.MemberCenterActivity",
}
TARGET_CLASS_KINDS = {
    name: ("fragment" if name.endswith("Fragment") else "activity")
    for name in TARGET_DEX_CLASSES
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(command: list[str]) -> dict:
    try:
        # aapt emits bytes outside the active Windows ANSI code page for this APK.
        # Decode explicitly so one localized resource name cannot abort extraction.
        result = subprocess.run(command, capture_output=True, text=False, check=False)
        decode = lambda value: value.decode("utf-8", errors="replace")
        return {"command": command, "exitCode": result.returncode,
                "stdout": decode(result.stdout), "stderr": decode(result.stderr)}
    except FileNotFoundError:
        return {"command": command, "exitCode": None, "stdout": "", "stderr": "not found"}


def lottie_info(name: str, data: bytes) -> dict | None:
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or not {"v", "layers"}.issubset(value):
        return None
    return {"apkPath": name, "sha256": sha256_bytes(data), "bytes": len(data),
            "version": value.get("v"), "width": value.get("w"), "height": value.get("h"),
            "frameRate": value.get("fr"), "inPoint": value.get("ip"), "outPoint": value.get("op"),
            "layerCount": len(value.get("layers", []))}


def layout_geometry(decoded: str) -> dict:
    element_lines = re.findall(r"^(\s*)E:\s+([^\s(]+)", decoded, re.MULTILINE)
    attribute_lines = re.findall(r"^\s*A:\s+(.+)$", decoded, re.MULTILINE)
    element_counts = Counter(name for _, name in element_lines)
    geometry_attributes = [
        value.strip()
        for value in attribute_lines
        if re.search(
            r"(?:layout_(?:width|height|margin|constraint)|padding|orientation|minWidth|minHeight|maxWidth|maxHeight)",
            value,
            re.IGNORECASE,
        )
    ]
    return {
        "rootElement": element_lines[0][1] if element_lines else None,
        "elementCount": len(element_lines),
        "attributeCount": len(attribute_lines),
        "geometryAttributeCount": len(geometry_attributes),
        "elementTypes": dict(sorted(element_counts.items())),
        "geometryAttributes": geometry_attributes,
    }


def read_uleb128(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7


def dex_class_definitions(data: bytes) -> dict[str, dict]:
    """Read class_def descriptors from a standard DEX without decompiling code."""
    if not data.startswith(b"dex\n"):
        raise ValueError("unsupported DEX magic")
    string_count, string_offset = struct.unpack_from("<II", data, 0x38)
    type_count, type_offset = struct.unpack_from("<II", data, 0x40)
    class_count, class_offset = struct.unpack_from("<II", data, 0x60)
    strings = []
    for index in range(string_count):
        value_offset = struct.unpack_from("<I", data, string_offset + index * 4)[0]
        _, value_offset = read_uleb128(data, value_offset)
        value_end = data.index(0, value_offset)
        strings.append(data[value_offset:value_end].decode("utf-8", errors="replace"))
    type_string_indexes = [
        struct.unpack_from("<I", data, type_offset + index * 4)[0]
        for index in range(type_count)
    ]
    definitions = {}
    for index in range(class_count):
        class_type_index, access_flags, superclass_type_index = struct.unpack_from(
            "<III", data, class_offset + index * 32
        )
        descriptor = strings[type_string_indexes[class_type_index]]
        superclass = (
            strings[type_string_indexes[superclass_type_index]]
            if superclass_type_index != 0xFFFFFFFF
            else None
        )
        definitions[descriptor] = {
            "accessFlags": f"0x{access_flags:08x}",
            "superclassDescriptor": superclass,
        }
    return definitions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--output", type=Path, default=Path("work/maoxiang-reference"))
    parser.add_argument("--repo", type=Path, default=Path("."), help="AAA repository root")
    parser.add_argument("--tools", type=Path, default=DEFAULT_TOOLS)
    args = parser.parse_args()
    apk, output, repo, tools = args.apk.resolve(), args.output.resolve(), args.repo.resolve(), args.tools.resolve()
    if not apk.is_file():
        parser.error(f"APK not found: {apk}")
    output.mkdir(parents=True, exist_ok=True)

    apk_bytes = apk.read_bytes()
    aapt = tools / "aapt.exe"
    aapt2 = tools / "aapt2.exe"
    dexdump = tools / "dexdump.exe"
    tool_results = {
        "aaptBadging": run([str(aapt), "dump", "badging", str(apk)]),
        "aaptManifest": run([str(aapt), "dump", "xmltree", str(apk), "AndroidManifest.xml"]),
        "aapt2Version": run([str(aapt2), "version"]),
    }
    build_tools_revision = tools.name
    aapt2_version = (
        tool_results["aapt2Version"]["stdout"]
        or tool_results["aapt2Version"]["stderr"]
    ).strip()
    # Tool output is saved separately to keep the JSON indexes compact/readable.
    (output / "aapt-badging.txt").write_text(tool_results["aaptBadging"]["stdout"], encoding="utf-8")
    (output / "android-manifest-tree.txt").write_text(tool_results["aaptManifest"]["stdout"], encoding="utf-8")

    with ZipFile(apk) as archive:
        archive_names = set(archive.namelist())
        entries = []
        lotties = []
        dex_entries = []
        for info in archive.infolist():
            entry = {"path": info.filename, "bytes": info.file_size, "compressedBytes": info.compress_size,
                     "crc32": f"{info.CRC:08x}"}
            entries.append(entry)
            if info.filename.endswith(".dex"):
                dex_entries.append(entry)
            if info.filename.startswith("assets/") and info.filename.lower().endswith(".json"):
                item = lottie_info(info.filename, archive.read(info))
                if item:
                    lotties.append(item)

        sample_root = repo / "client" / "public" / "reference-lottie"
        sample_root.mkdir(parents=True, exist_ok=True)
        selected = []
        for local_name, apk_name in SELECTED_LOTTIES.items():
            data = archive.read(apk_name)
            target = sample_root / local_name
            target.write_bytes(data)
            selected.append({"localPath": target.relative_to(repo).as_posix(), "apkPath": apk_name,
                             "sha256": sha256_bytes(data), "bytes": len(data)})

        json_asset_root = repo / "client" / "src" / "assets" / "app-reference"
        json_asset_root.mkdir(parents=True, exist_ok=True)
        selected_assets = []
        for local_name, apk_name in SELECTED_JSON_ASSETS.items():
            data = archive.read(apk_name)
            # Validate before copying; the checked-in file remains byte-for-byte identical.
            json.loads(data)
            target = json_asset_root / local_name
            target.write_bytes(data)
            selected_assets.append({
                "kind": "json-config",
                "localPath": target.relative_to(repo).as_posix(),
                "apkPath": apk_name,
                "sha256": sha256_bytes(data),
                "bytes": len(data),
            })

        selected_layout_root = output / "selected-layouts"
        selected_layout_root.mkdir(parents=True, exist_ok=True)
        layout_index = []
        for spec in SELECTED_LAYOUTS:
            apk_path = spec["apkPath"]
            if apk_path not in archive_names:
                raise RuntimeError(f"selected layout missing from APK: {apk_path}")
            decoded = run([str(aapt2), "dump", "xmltree", "--file", apk_path, str(apk)])
            if decoded["exitCode"] != 0 or not decoded["stdout"].strip():
                raise RuntimeError(f"aapt2 could not decode {apk_path}: {decoded['stderr']}")
            decoded_bytes = decoded["stdout"].encode("utf-8")
            output_name = f"{spec['id']}.xmltree.txt"
            (selected_layout_root / output_name).write_bytes(decoded_bytes)
            compiled = archive.read(apk_path)
            layout_index.append({
                **spec,
                "outputPath": f"selected-layouts/{output_name}",
                "compiledSha256": sha256_bytes(compiled),
                "decodedSha256": sha256_bytes(decoded_bytes),
                **layout_geometry(decoded["stdout"]),
            })

        target_descriptors = {
            name: f"L{fqcn.replace('.', '/')};"
            for name, fqcn in TARGET_DEX_CLASSES.items()
        }
        target_definitions = {name: [] for name in TARGET_DEX_CLASSES}
        target_definition_details = {}
        definition_dex_payloads = {}
        for dex_entry in dex_entries:
            dex_name = dex_entry["path"]
            dex_data = archive.read(dex_name)
            defined_classes = dex_class_definitions(dex_data)
            for name, descriptor in target_descriptors.items():
                if descriptor in defined_classes:
                    target_definitions[name].append(dex_name)
                    target_definition_details[name] = defined_classes[descriptor]
                    definition_dex_payloads[dex_name] = dex_data

        missing_classes = [name for name, locations in target_definitions.items() if not locations]
        duplicate_classes = [name for name, locations in target_definitions.items() if len(locations) != 1]
        if missing_classes or duplicate_classes:
            raise RuntimeError(
                f"DEX target resolution failed; missing={missing_classes}, nonUnique={duplicate_classes}"
            )

        dex_validations = {}
        with tempfile.TemporaryDirectory(prefix="maoxiang-dex-") as temp_dir:
            for dex_name, dex_data in definition_dex_payloads.items():
                temp_path = Path(temp_dir) / dex_name
                temp_path.write_bytes(dex_data)
                verification = run([str(dexdump), "-e", "-n", str(temp_path)])
                if verification["exitCode"] != 0:
                    raise RuntimeError(f"dexdump class verification failed for {dex_name}")
                expected_descriptors = [
                    target_descriptors[name]
                    for name, locations in target_definitions.items()
                    if locations == [dex_name]
                ]
                matched_descriptors = [
                    descriptor
                    for descriptor in expected_descriptors
                    if f"Class descriptor  : '{descriptor}'" in verification["stdout"]
                ]
                if matched_descriptors != expected_descriptors:
                    raise RuntimeError(
                        f"dexdump class mismatch for {dex_name}: "
                        f"expected={expected_descriptors}, matched={matched_descriptors}"
                    )
                dex_validations[dex_name] = {
                    "tool": "dexdump -e -n",
                    "exitCode": verification["exitCode"],
                    "sha256": sha256_bytes(dex_data),
                    "stdoutBytes": len(verification["stdout"].encode("utf-8")),
                    "matchedDescriptors": matched_descriptors,
                }

        dex_class_index = {
            "schemaVersion": 1,
            "method": "DEX class_defs parser cross-checked against dexdump -e -n Class descriptor output",
            "tool": str(dexdump),
            "buildToolsRevision": build_tools_revision,
            "aapt2Version": aapt2_version,
            "targetCount": len(TARGET_DEX_CLASSES),
            "foundCount": len(TARGET_DEX_CLASSES) - len(missing_classes),
            "classes": [
                {
                    "name": name,
                    "fqcn": fqcn,
                    "kind": TARGET_CLASS_KINDS[name],
                    "manifestDeclared": fqcn in tool_results["aaptManifest"]["stdout"],
                    "buildToolsRevision": build_tools_revision,
                    "descriptor": target_descriptors[name],
                    "dexEntry": target_definitions[name][0],
                    **target_definition_details[name],
                    "dexValidation": dex_validations[target_definitions[name][0]],
                }
                for name, fqcn in TARGET_DEX_CLASSES.items()
            ],
        }

    badging = tool_results["aaptBadging"]["stdout"]
    package_match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    launch_match = re.search(r"launchable-activity: name='([^']+)'", badging)
    metadata = {
        "schemaVersion": 1,
        "source": {"path": str(apk), "sha256": sha256_bytes(apk_bytes), "bytes": len(apk_bytes)},
        "package": ({"name": package_match.group(1), "versionCode": package_match.group(2),
                     "versionName": package_match.group(3)} if package_match else None),
        "launchableActivity": launch_match.group(1) if launch_match else None,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "tools": {key: {"command": value["command"], "exitCode": value["exitCode"],
                          "stderr": value["stderr"]} for key, value in tool_results.items()},
        "entryCount": len(entries), "assetCount": sum(x["path"].startswith("assets/") for x in entries),
        "resourceCount": sum(x["path"].startswith("res/") for x in entries), "dexEntries": dex_entries,
    }
    (output / "apk-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (output / "apk-entry-index.json").write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    (output / "lottie-index.json").write_text(json.dumps(lotties, indent=2) + "\n", encoding="utf-8")
    (output / "layout-geometry-index.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "tool": str(aapt2),
            "layoutCount": len(layout_index),
            "layouts": layout_index,
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "dex-class-index.json").write_text(
        json.dumps(dex_class_index, indent=2) + "\n",
        encoding="utf-8",
    )

    provenance = {"schemaVersion": 1, "sourceApk": metadata["source"], "sourcePackage": metadata["package"],
                  "launchableActivity": metadata["launchableActivity"], "extractionScript":
                  "scripts/extract-maoxiang-apk-reference.py",
                  "licenseStatus": "authorized selected first-party UI and interaction migration",
                  "selectedAssets": selected_assets, "selectedLotties": selected,
                  "selectedLayouts": [
                      {
                          "id": item["id"],
                          "surface": item["surface"],
                          "apkPath": item["apkPath"],
                          "workOutput": item["outputPath"],
                          "compiledSha256": item["compiledSha256"],
                          "decodedSha256": item["decodedSha256"],
                      }
                      for item in layout_index
                  ],
                  "dexClasses": {
                      "workOutput": "dex-class-index.json",
                      "buildToolsRevision": build_tools_revision,
                      "targets": [
                          {
                              "name": item["name"],
                              "fqcn": item["fqcn"],
                              "kind": item["kind"],
                              "manifestDeclared": item["manifestDeclared"],
                              "buildToolsRevision": item["buildToolsRevision"],
                              "dexEntry": item["dexEntry"],
                          }
                          for item in dex_class_index["classes"]
                      ],
                  },
                  "screenMapping": "docs/app-reference/screen-mapping.json"}
    docs_root = repo / "docs" / "app-reference"
    docs_root.mkdir(parents=True, exist_ok=True)
    (docs_root / "apk-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    report = f"""# APK reference extraction

Generated from a local, user-supplied APK; this dossier contains no complete APK or decompiler output.

- SHA-256: `{metadata['source']['sha256']}`
- Archive entries: {metadata['entryCount']}
- Assets: {metadata['assetCount']}; resources: {metadata['resourceCount']}; DEX files: {len(dex_entries)}
- Identified Lottie JSON assets: {len(lotties)}
- Selected migrated Lottie assets: {len(selected)}
- Selected verbatim JSON assets: {len(selected_assets)}
- Decoded layout geometry samples: {len(layout_index)}
- Indexed target Activity/Fragment classes: {dex_class_index['foundCount']}

See `apk-metadata.json`, `apk-entry-index.json`, `lottie-index.json`, `layout-geometry-index.json`,
`selected-layouts/`, `dex-class-index.json`, `aapt-badging.txt`, and `android-manifest-tree.txt`.
"""
    (output / "EXTRACTION_REPORT.md").write_text(report, encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "selectedLotties": len(selected),
        "selectedAssets": len(selected_assets),
        "decodedLayouts": len(layout_index),
        "dexClasses": dex_class_index["foundCount"],
        "lotties": len(lotties),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
