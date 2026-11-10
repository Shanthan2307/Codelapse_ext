# Running the demo

How to run a test session with your student testers: build the extension, start the submission website where their laptops can reach it, and reset between runs. Students follow [TESTER_GUIDE.md](TESTER_GUIDE.md).

## One-time setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/Shanthan2307/Codelapse_ext.git
cd Codelapse_ext
npm install
```

### Build the extension

```bash
npm run package
```

This writes `codelapse-0.1.0.vsix` to the repository root. The same file is attached to the [pilot release on GitHub](https://github.com/Shanthan2307/Codelapse_ext/releases/tag/v0.1.0-pilot), so testers can download it there. If you change the extension, rebuild it and attach the new file to a new release.

### Set the AI key

The website uses an AI model to write the questions and review the answers. By default it uses open-source models through Featherless; put the key in `apps/web/.env.local` (git ignores this file):

```bash
echo 'FEATHERLESS_API_KEY=rc_...' >> apps/web/.env.local
chmod 600 apps/web/.env.local
```

OpenAI and Claude also work: see **Choosing the AI** in the README. Without a working key, uploads still succeed, but each submission's questions show as failed; you can click **Try again** on the instructor page once the key works.

### Check the key works

Before the session, upload one scripted recording yourself (see **Try it yourself first** below) and confirm the questions appear within a minute. If the instructor page says the account has no credit or the concurrency limit was reached, fix that in the provider's dashboard (or wait a minute), then click **Try again**.

### Set up the course

The course, the assignment text and the five student names are in `apps/web/src/lib/course.ts`. Replace "Student A" to "Student E" with your testers' names before the session.

## Start the website for testers

Testers' laptops must be on the same network (for example the same Wi-Fi) as the computer running the site.

```bash
npm run demo
```

This builds the site, checks for the API key, makes sure the instructor pages have a password, prints the addresses to give your testers, and starts the site on port 3100 for the whole network. Stop it with `Ctrl+C`. (`npm run demo -- --no-build` skips the build.)

It prints something like:

```
Give testers this submission page address (VS Code asks for it the first time they open the submission page):
  http://192.168.1.23:3100/courses/cs101/assignments/a3-reverse
Instructor view (on this computer use localhost):
  http://192.168.1.23:3100/instructor
Instructor password: 3kQx9vL2mT7a   (any user name; saved in apps/web/.env.local)
```

Write the submission page address on the board. Testers paste it into VS Code when it asks.

### The instructor password

The instructor pages, the comparison, ratings and the research export ask for a password, so testers on the same network can't open each other's work. The first `npm run demo` creates one, saves it as `CODELAPSE_INSTRUCTOR_PASSWORD` in `apps/web/.env.local`, and prints it every time. Your browser asks for it once: enter any user name and the password. To change it, edit that line in `.env.local`. The student pages (the assignment, submissions and questions) need no password.

### Doing it by hand

```bash
npm run web:build
cd apps/web && CODELAPSE_INSTRUCTOR_PASSWORD=choose-one npx next start -H 0.0.0.0 -p 3100
```

Without `CODELAPSE_INSTRUCTOR_PASSWORD` the instructor pages are open to anyone who can reach the site. Find your computer's address on macOS with `ipconfig getifaddr en0` (Wi-Fi), and give testers `http://<address>:3100/courses/cs101/assignments/a3-reverse`.

If testers can't reach the site, check that your firewall allows incoming connections for Node.js, and that the network doesn't isolate devices from each other (guest Wi-Fi often does).

## Where submissions are stored

Every submission is a folder in `apps/web/data/submissions/`: the uploaded `.codelapse` file and code, `submission.json`, `questions.json` and `answers.json`, and `evaluation.json`. Back it up after a session; it holds your testers' work.

## Reset between runs

```bash
npm run demo:reset
```

This moves `apps/web/data` to `apps/web/data-archive-<date-time>`, so the next run starts empty. Nothing is deleted. You can also move or delete the folder yourself.

Both `npm run demo` and `npm run demo:reset` use `CODELAPSE_DATA_DIR` instead of `apps/web/data` when it is set.

## Try it yourself first

`fixtures/recordings` holds scripted recordings of this assignment, made by driving the real extension. To walk through the flow without writing code:

1. Start the site (`npm run demo`, or `npm run web:dev` on your own machine only).
2. Open the assignment page and click **Submit Assignment**.
3. Upload, for example, `fixtures/recordings/honest-incremental/honest-incremental.codelapse` with `fixtures/recordings/honest-incremental/submission/reverse.c`.
4. Answer the questions, then open the instructor view.

Reset afterwards so these test submissions don't mix with your testers' work.

## Security

The instructor pages and research data are behind the instructor password, but students have no sign-in: anyone who can reach the site can submit as any student, and anyone who has a submission's link can open that student's confirmation and questions. Run it only on a network you trust, for the length of the session, and stop it afterwards.
