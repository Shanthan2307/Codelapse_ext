# CodeLapse tester guide

Thank you for testing CodeLapse. You'll write one small program in VS Code, in **C or Python** (your instructor tells you which), while CodeLapse records how you work. Then you upload it to a demo course website and answer four short questions about it.

**Read the assignment brief first.** The course website has a PDF for each language with the full assignment, worked examples, hints and a checklist: open the assignment page and click **Download the assignment brief (PDF)**.

**Time needed:** about 45–60 minutes for the program, plus up to an hour for the questions.

**Mac or Windows?** Shortcuts are written as **Mac / Windows**, for example **`Cmd+S` / `Ctrl+S`**.

> [!IMPORTANT]
> **Please type the code yourself, and turn off AI helpers** such as GitHub Copilot for this test (Extensions view → click it → **Disable**). Typos and failed builds are completely fine: fixing them is normal and useful.

## What CodeLapse records

| Recorded | Not recorded |
|---|---|
| Files inside the **one folder you choose**, as you type | Anything outside that folder |
| Which file you switch to, and when | Other VS Code windows and projects |
| Builds and runs in the VS Code terminal or tasks, with their result and output | Your full file paths and your username (paths are stored relative to the folder) |
| Pauses and long deletions | Websites, other apps, keystrokes outside VS Code |

The recording stays on your computer until you export it and upload it yourself.

## 1. Get ready

You need:

- **VS Code 1.93 or newer.** Check with **Code → About Visual Studio Code** (Mac) or **Help → About** (Windows).
- **For C: a C compiler.** Open a terminal and run:

  ```bash
  gcc --version
  ```

  If you see a version number, you're set (on a Mac this may say "clang"; that's fine). If not: on a Mac, run `xcode-select --install`; on Windows, ask your instructor which compiler to install.
- **For Python: Python 3.10 or newer.** Run `python3 --version` (on Windows, `python --version`). If it's missing, install it from [python.org](https://www.python.org/downloads/).
- **A normal terminal shell** in VS Code: bash, zsh or PowerShell (the defaults on Mac, Linux and Windows). CodeLapse can't see builds in other shells.

## 2. Install CodeLapse

1. Download `codelapse-0.1.0.vsix` from the [CodeLapse pilot release](https://github.com/Shanthan2307/Codelapse_ext/releases/tag/v0.1.0-pilot) (under **Assets**), or get it from your instructor.
2. In VS Code, open the **Extensions** view (the four squares on the left).
3. Click **`···`** at the top of the Extensions panel and choose **Install from VSIX…**
4. Pick the `.vsix` file and click **Install**.

Or, from a terminal:

```bash
code --install-extension codelapse-0.1.0.vsix
```

**Your instructor will give you a website address** for the submission page, such as `http://192.168.1.23:3100/courses/cs101/assignments/a3-reverse`. VS Code asks for it the first time you open the submission page, and remembers it. To change it later, open **Settings** (**`Cmd+,` / `Ctrl+,`**) and search for **CodeLapse: Submission Url**.

## 3. Start recording

1. Create a new, empty folder for this assignment, for example `reverse-assignment`.
2. In VS Code, choose **File → Open Folder…** and open it.
3. CodeLapse asks which folder to record. Click **Choose Folder** and pick your new folder. You can also click **CodeLapse: Choose folder** in the status bar at the bottom of the window.
4. The status bar now shows **CodeLapse: reverse-assignment** with a record icon. You're recording.

To see the walkthrough again, open the Command Palette (**`Cmd+Shift+P` / `Ctrl+Shift+P`**) and run **CodeLapse: Get Started**.

## 4. Write the program

The full assignment, with examples and hints, is in the PDF brief for your language. In short:

**C:** create `reverse.c`.

> Implement `void reverse(char *s)`, which reverses a string **in place** (no second string), and `int count_vowels(const char *s)`, which returns the number of vowels in a string. Your `main` function should call both and print the results. It must compile without warnings using `gcc -Wall`.

```bash
gcc -Wall -o reverse reverse.c
./reverse
```

**Python:** create `reverse.py`.

> Implement `def reverse(text: str) -> str`, which returns the string reversed **without** slicing (`[::-1]`), `reversed()` or any helper that reverses for you: use a loop. Implement `def count_vowels(text: str) -> int`, which counts vowels in either case. Under `if __name__ == "__main__":`, call both and print the results.

```bash
python3 reverse.py
```

Work the way you normally would, and run your program often in the VS Code terminal (**Terminal → New Terminal**). Every build and run is recorded with whether it worked, so don't worry about errors along the way. Save your file (**`Cmd+S` / `Ctrl+S`**) when you're done.

## 5. Export your recording

1. Open the Command Palette (**`Cmd+Shift+P` / `Ctrl+Shift+P`**).
2. Run **CodeLapse: Export Assignment Bundle (.codelapse)**.
3. If asked, click **Stop and Continue** to end the recording.
4. Choose where to save the file, for example next to your folder. You get `reverse-assignment.codelapse`.
5. Click **Open Submission Page** in the message that appears, or run **CodeLapse: Open Submission Page** from the Command Palette.

## 6. Submit and answer the questions

1. Make sure you're on the assignment for **your language**: "Assignment 3 (C)" or "Assignment 3 (Python)". The course page lists both.
2. Pick your name from the list. (The demo has no sign-in; please pick your own name.)
3. Add your `.codelapse` file and your code file (`reverse.c` or `reverse.py`). You can drag them onto the page.
4. Click **Submit Assignment**.
5. Your four questions appear on the next page after a short wait. Two are about decisions you made while working, two are about your code.
6. **You have one hour from submitting** to answer. Write a few sentences each, in your own words. A timer shows the time left, and your draft is kept if you refresh the page.
7. Click **Submit answers**. You can only submit once.

That's it. Thank you!

## If something goes wrong

| What you see | What to do |
|---|---|
| The status bar says **CodeLapse: Choose folder** or **Not recording** | Click it and choose your assignment folder. |
| Your builds don't seem to be recorded | Make sure you build in the VS Code terminal (not a separate Terminal app), and that the terminal is bash, zsh or PowerShell. Building with **Terminal → Run Task…** is also recorded. |
| "Choose who you are before submitting." | Pick your name in the list at the top of the form. |
| "Attach your .codelapse recording." | Add the `.codelapse` file you exported in step 5. |
| "The recording could not be read: … Export it again with "CodeLapse: Export Assignment Bundle"." | The file is damaged or isn't a CodeLapse bundle. Export it again and upload the new file. |
| "The recording has no sessions in it." | Nothing was recorded in that folder. Check you chose the right folder in step 3. |
| "The .codelapse file is larger than 25 MB." | Tell your instructor. |
| "Attach your code …" | Add your `reverse.c` or `reverse.py`. |
| "… is not a C source file …" or "… is not a Python file …" | You may be on the other language's assignment page, or have added the wrong file. Upload only your code file (`.c`/`.h` for C, `.py` for Python), not the compiled program or other files. |
| "… is larger than 512 KB." or "… was attached twice." | Remove the extra or wrong file and try again. |
| "Your questions could not be prepared." | Nothing to do: your instructor has been told, and your submission was received. |
| "The time to answer has ended." | The hour has passed. Your submission still counts; tell your instructor if something went wrong. |

## What your instructor sees

- Your submitted code and your answers.
- A summary of your recording: how long you worked, how much was typed or added in larger chunks (for example by pasting or autocomplete), and how your builds went.
- Whether the recording ends with the same code you submitted.
- Points in your recording that the questions were based on, and a short review of how well your answers explain your code.

None of this is a grade or an accusation. Your instructor reads it and decides what it means.
