1. To get a visual mockup of the app you want to build, use the following prompt:

```
Use the frontend design skill, I want to create a scavenger hunt mini app. This is for my coworking space, all 16 members will be given a QR code and asked to hide it somewhere in the space. We should show a leaderboard that displays everyone that has found a QR code. Our goal with the app is to have people at the coworking space have fun by looking around to find the hidden QR codes. 

Focus on the UI/visual design, not the app logic. Focus on mobile-first design. Use placeholder data, mock profiles and avatars and mock states if needed. Skip signup/auth screens entirely. Skip QR scanning screens, we are going to use native camera app. 

Before designing, ask me questions to clarify what I want to build.
```

2. To Create a technical implementation of your app based on the mockup, use the following prompt:

```
Create a technical implementation of the app based on this mockup: [[Attach mockup]]

Here are some key points to consider: [[Taken from conversation that created the mockup above]].

**Core Mechanics:**
- Each member hides their own QR code somewhere in the space
- Members scan codes with native camera app
- Finding your own code doesn't count toward your score (max 15 points)

**Design Direction:**
- Playful + minimal aesthetic

**Screens Built:**
- Home/Leaderboard — Main focus is the ranked leaderboard; personal progress card at top
- User Detail — Tap any user to see which of the 16 QR codes they've found or not found (organized by who hid it)

**Excluded:**
- No time limit
- No prizes
- No activity feed
- No easter eggs/achievements

The mockup may mock profiles and avatars, for our implementation, we are using the 'local-first-auth' library to handle signup and authentication, so users will have a profile and avatar after they complete the onboarding flow.

Look up examples of other mini apps inside `docs/mini-app-examples.md` to see if you can learn anything from them, bring them into your implementation.

Lastly, I need some admin features to set up scavenger hunt.

Ask me questions if you need to clarify anything.
```