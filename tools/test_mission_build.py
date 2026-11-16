#!/usr/bin/env python3
"""Build the checked-in content and verify mission corrections survive landmark merging.

Run: python3 tools/test_mission_build.py
No browser, network, external mission source folder or audio is required.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MissionBuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "i5.js"
            # The build normally imports a separate writing workspace. Test only committed content.
            env = dict(os.environ, I5_MISSIONS_SRC=folder)
            subprocess.run([sys.executable, str(ROOT / "tools/build.py"), "--out", str(output)],
                           env=env, check=True, capture_output=True, text=True)
            cls.data = json.loads(output.read_text().split("window.I5DATA=", 1)[1].rstrip(";\n"))
        cls.turnoffs = json.loads((ROOT / "content/v2/ca-missions.json").read_text())["places"]

    def test_each_mission_has_one_turnoff_with_reviewed_narration(self):
        for source in self.turnoffs:
            with self.subTest(mission=source["name"]):
                matches = [p for p in self.data["places"] if p.get("mission") == source["mission"]]
                self.assertEqual(len(matches), 1)
                place = matches[0]
                for key in ("text", "more", "src", "src2", "wiki"):
                    if key in source:
                        self.assertEqual(place[key], source[key], key)
                self.assertEqual(place["detour"], dict(source["detour"], exit=str(source["detour"]["exit"])))
                self.assertEqual(place["ex"], str(source["exit"]))
                self.assertFalse(place["vis"])

    def test_existing_landmark_ids_remain_stable(self):
        expected = {7: "ca82-mission-san-juan-capistrano", 17: "ca157-mission-san-fernando",
                    18: "ca53-mission-san-luis-rey"}
        for number, saved_id in expected.items():
            self.assertEqual(next(p["id"] for p in self.data["places"] if p.get("mission") == number), saved_id)

    def test_mission_pages_use_checked_in_corrections(self):
        source = json.loads((ROOT / "content/missions.json").read_text())
        self.assertEqual(len(source), 21)
        self.assertEqual(self.data["missions"], source)

    def test_corridor_content_is_preserved(self):
        self.assertEqual(len(self.data["places"]), 377)
        self.assertEqual(len(self.data["trivia"]), 101)
        self.assertEqual(len(self.data["zones"]), 68)
        self.assertEqual(len({p["id"] for p in self.data["places"]}), 377)


if __name__ == "__main__":
    unittest.main()
