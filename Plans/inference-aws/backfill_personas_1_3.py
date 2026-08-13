#!/usr/bin/env python3
"""
One-off: save the 15 already-generated S3 images for personas 1-3 to DB.

Assignment (by upload timestamp order):
  Persona 1 -> images 1-5  (02:30:19 - 02:31:58)
  Persona 2 -> images 6-10 (02:32:30 - 02:34:07)
  Persona 3 -> images 11-15(02:34:42 - 02:36:20)

For each persona: image 1 -> isPrimary=true (replaces original /personas/N.webp),
                  images 2-5 -> isPrimary=false (gallery media).
"""

import os
from pathlib import Path
import psycopg2

REPO_ROOT = Path(__file__).parent.parent.parent

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    env_path = REPO_ROOT / "backend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            DATABASE_URL = line.split("=", 1)[1].strip().strip('"')
            break

# S3 keys in upload order (from `aws s3 ls`, sorted by timestamp)
S3_KEYS_ORDERED = [
    "images/ea6fc6d8-76c7-471b-8148-969eba71b78a.png",
    "images/2b38db89-26ad-4b3b-a5b9-640db1c6fb05.png",
    "images/e1b2f7a2-7504-4109-bddc-d053309d3d78.png",
    "images/719e40c0-3fb1-4409-8448-9480b778874a.png",
    "images/e04370f4-a43b-43b3-a64c-ffd48ef0a88e.png",
    "images/5a3e1106-1bcd-4c1d-b3ab-963d2ff91674.png",
    "images/494159c8-2b79-427c-b2f0-7fb3d04d98f3.png",
    "images/1df72353-7081-48e3-9803-5d00ead52bf9.png",
    "images/c2a9cbca-8879-46b9-a0e0-c3288c1c4666.png",
    "images/cd75674f-4d18-4cdf-8b79-5472a536a4ee.png",
    "images/bc1255b4-1eb0-44d4-a33e-5319783b18cb.png",
    "images/62d2f58e-59e5-4db5-82a0-c5663b3a0b53.png",
    "images/7b4ec24c-2cae-47be-a3be-a99c935a9c38.png",
    "images/c117e55c-464f-4ea0-9b90-826547a90cc3.png",
    "images/688a1fa4-5660-4958-a0f9-51227ccc69dd.png",
]

PERSONA_GROUPS = {
    1: S3_KEYS_ORDERED[0:5],
    2: S3_KEYS_ORDERED[5:10],
    3: S3_KEYS_ORDERED[10:15],
}

def get_character_id(cur, persona_idx: int) -> str:
    for ext in (".webp", ".png", ".jpg", ".jpeg"):
        cur.execute(
            """
            SELECT c.id FROM "Character" c
            JOIN "CharacterMedia" m ON m."characterId" = c.id
            WHERE m.url = %s
            LIMIT 1
            """,
            (f"/personas/{persona_idx}{ext}",),
        )
        row = cur.fetchone()
        if row:
            return row[0]
    return ""


def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    total = 0

    for persona_idx, s3_keys in PERSONA_GROUPS.items():
        char_id = get_character_id(cur, persona_idx)
        if not char_id:
            print(f"[persona {persona_idx}] character not found in DB, skipping")
            continue

        # Demote existing primary
        cur.execute(
            'UPDATE "CharacterMedia" SET "isPrimary" = false WHERE "characterId" = %s AND "isPrimary" = true',
            (char_id,),
        )

        for sort_idx, s3_key in enumerate(s3_keys):
            is_primary = (sort_idx == 0)
            cur.execute(
                """
                INSERT INTO "CharacterMedia" (id, "characterId", kind, url, "isPrimary", sort, "likesBase", "createdAt")
                VALUES (gen_random_uuid(), %s, 'image', %s, %s, %s, 0, NOW())
                """,
                (char_id, s3_key, is_primary, sort_idx),
            )
            total += 1
            print(f"  [persona {persona_idx}] {'PRIMARY' if is_primary else 'gallery'} -> {s3_key}")

    conn.commit()
    cur.close()
    conn.close()
    print(f"\nDone: {total} rows inserted.")


if __name__ == "__main__":
    main()
