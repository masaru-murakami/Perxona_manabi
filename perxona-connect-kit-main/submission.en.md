# AI Mentor Mock Exam 1.0

**Project name**: AI Mentor Mock Exam (CG Creator Certification ver.)
**Demo URL**: https://perxona-manabi.netlify.app/
**Repository**: https://github.com/masaru-murakami/Perxona_manabi

---

## 1. Concept & Pitch

A study app that embeds a Perxona 3D avatar as a "study coach" into a mock exam (20 sets, 400 questions) for CG-ARTS' "CG Creator Certification, Basic."

### What makes it different

**1. Get through a lot of questions, cheered on by an avatar**
Working through a question bank alone is easy to give up on. Here, a 3D avatar stands right beside you — celebrating with you when you get it right, and gently encouraging you when you don't. The goal is to lower the barrier to the kind of repetition that real learning requires.

**2. AI generates explanations and a final review on the spot**
Every question already ships with a short built-in explanation, but pressing "Ask the avatar more" has Claude (the Anthropic API) generate a deeper, situation-aware explanation on the fly — tailored to that specific question and whether you got it right — which the avatar then speaks aloud. After the mock exam, it also generates a spoken summary that analyzes your weak points from the score breakdown across 10 subject areas. It's the kind of personalized feedback a static answer key can't give you.

**3. Japanese accent mode — a feature born from a bug**
During development, a bug caused the English UI to use a Japanese-only voice, so English came out with a heavy Japanese accent. After fixing it, we kept the effect on purpose as an opt-in "accent mode" toggle, so anyone who wants to hear it can turn it on for fun. Instead of erasing the mistake, we kept it as a feature.

---

## 2. How to use it

1. On the start screen, choose **Practice mode** (each question is scored and explained immediately) or **Exam mode** (a 60-minute timer, scored all at once at the end)
2. Pick Set 1–20, or a random draw, to start — the avatar greets you
3. Pick an answer choice; the avatar reacts with a line and a motion depending on whether you got it right
4. Press "Ask the avatar more" for a deeper AI-generated explanation
5. After the last question, check the radar chart (score by subject area) and the avatar's spoken summary on the results screen
6. From the avatar panel in the corner, freely switch the **background scene**, **Japanese accent mode**, and the UI language (Japanese/English)

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| 3D avatar rendering / speech synthesis | Perxona Connect Kit (`<sv-presenter>` Presenter SDK) |
| Conversation / explanation generation AI | Claude API (Anthropic, `claude-sonnet-5`) |
| Backend | Node.js / Express (local development), Netlify Functions (production) |
| Hosting | Netlify (GitHub-connected, auto-deploy on push) |
| Quiz engine | Plain HTML/JS (no build step; deterministically generates 20 sets from a 300-question bank) |

---

## 4. Roadmap

- **Scene-driven tone**: change the avatar's tone and advice depending on the selected background scene (office, outdoor school, etc.)
- **Voice/text Q&A**: let test-takers ask the avatar free-form questions on the spot, with voice input support
- **Custom questions via spreadsheet**: turn any spreadsheet of questions into a mock exam for any certification or subject, with no extra setup
- **Avatar growth system**: your own avatar grows — visually and behaviorally — the more you practice
- **Battle mode**: compete against other users' avatars on the server
  - Time trial (race for speed)
  - Multi-answer (compete on correct-answer count/rate on the same questions)
