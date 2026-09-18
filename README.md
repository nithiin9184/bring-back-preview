# Connect Now

Create the N Connect app UI from scratch.

IMPORTANT:

The attached reference images are the PRIMARY visual reference for the design language, proportions, spacing, background treatment, surfaces and overall visual feel.

Do not make generic design decisions. Follow the specifications below precisely.

1. GLOBAL DESIGN SYSTEM

Overall visual style:

- Clean, premium, minimal and highly polished.

- Visual quality should feel comparable to modern Apple, Samsung and Meta mobile apps.

- Do not use a dashboard-style web design.

- Do not make components unnecessarily large.

- Avoid excessive cards and excessive glassmorphism.

- Keep the interface airy but compact.

Typography:

- Use ONE modern sans-serif font family throughout the entire app.

- Use a clean contemporary font similar in character to Inter/SF Pro.

- No serif fonts.

- No handwritten fonts.

- No decorative fonts.

- No mixing multiple font families.

- Primary text: #000000.

- Secondary text: #6B6B6B.

- Disabled text: #A0A0A0.

Font sizing:

- Screen titles: 20px, weight 600.

- Section titles: 16px, weight 600.

- Normal text: 14px, weight 400–500.

- Secondary text: 12px, weight 400.

- Small labels: 11–12px.

- Buttons: 13–14px, weight 600.

Do not use oversized typography.

2. GLOBAL BACKGROUND

Use the attached whole-app background reference.

Background:

- Base: #FFFFFF.

- Very soft pastel ambient areas using:

  - Peach: #FFE8DC

  - Pink: #FBE3EA

  - Blue: #E5EEFF

- These colors must appear as extremely soft blurred ambient gradients, NOT solid colored sections.

- Keep opacity very low.

- The white background must remain dominant.

- No strong gradients.

- No dark background.

- No purple-heavy background.

- No neon colors.

Animation:

- Ambient gradient areas should slowly drift/morph.

- Animation must be extremely slow and subtle.

- No bouncing background.

- No distracting particle effects.

- No flashy animations.

This same ambient background should continue consistently across the app unless a screen has an explicitly specified different background.

3. SPACING / SCREEN DIMENSIONS

Design primarily for mobile screens.

Use:

- 16px standard horizontal screen padding.

- Never allow important content to touch screen edges.

- Use 12–20px vertical spacing between related sections.

- Use 24–32px spacing between major sections.

- Keep content vertically balanced.

- Respect mobile safe areas.

Do not fill the screen with oversized elements.

4. INPUT DESIGN

Inputs are extremely important.

Every normal input must:

- Be a solid/light surface.

- NEVER use glassmorphism.

- Have a rounded pill shape.

- Height: approximately 44–48px.

- Border: 1px solid #D9D9D9.

- Background: #FFFFFF with approximately 95–100% opacity.

- Very soft shadow.

- Radius: 22–24px.

- Text: 14px.

- Placeholder: #8A8A8A.

- Horizontal padding: 16px.

INPUT WIDTH MUST BE CONTENT-APPROPRIATE.

Do NOT make every input full screen width.

Examples:

- Username: compact/medium width.

- PIN: very compact width.

- Number: width only sufficient for +91 and 10 digits.

- City: medium width.

- State: medium width.

- Email: wider.

- Password: wider.

- Full Name: medium/wider.

On mobile, inputs may expand when required for usability, but never create unnecessarily huge empty space.

5. BUTTON DESIGN

Primary buttons:

- Background: #000000.

- Text: #FFFFFF.

- Height: 44–46px.

- Border radius: 22–23px.

- Font size: 13–14px.

- Font weight: 600.

- No excessive shadow.

- Width should match the action and layout instead of automatically becoming huge.

Secondary actions:

- White/light background.

- Thin #D9D9D9 border.

- Black text.

- Same compact proportions.

Do not create giant CTA buttons.

6. GLASSMORPHISM

Glassmorphism is allowed ONLY for specifically designated major surfaces.

Approved glass surfaces:

- Home greeting surface.

- Profile surfaces.

- Notifications main surface.

- Settings main surface where appropriate.

- Chat profile pill.

- Bottom navigation bar.

- Other explicitly designated major profile surfaces.

Glass surfaces:

- White translucent background.

- Subtle backdrop blur.

- Very thin white/gray border.

- Soft shadow.

- Compact dimensions.

- High readability.

DO NOT use glassmorphism for:

- Inputs.

- Every list row.

- People You May Know users.

- Recent Chats.

- Followers.

- Following.

- Follow Requests.

- Nearby users.

- Individual notification rows.

- Individual settings rows.

Those must remain direct solid content.

7. SPLASH SCREEN

Duration:

- Exactly 3 seconds.

Layout:

- Center the N Connect logo/name horizontally and vertically.

- “N Connect” should be clean and premium.

- Do not use a handwritten font.

- Below it show:

  “End-to-End Encrypted”

Animation:

- Smooth logo reveal.

- Very subtle fade/scale movement.

- No spinner.

- No progress bar.

After exactly 3 seconds:

→ Login.

8. LOGIN SCREEN

Layout:

- Use the same ambient background.

- Keep the entire login composition compact.

- Center the main login area vertically with balanced spacing.

- Do not create a huge login card.

Top:

- N Connect branding.

Inputs:

1. Email / Phone / Username

2. Password

Password:

- Include a small eye icon inside the input.

- Show/hide password.

Below:

- Remember Me.

- Forgot Password.

Primary:

- Login button.

Secondary:

- Create Account.

- Continue with Google.

Google button:

- White/light surface.

- Thin border.

- Google icon on the left.

- Compact height.

Do not make inputs or buttons oversized.

9. CREATE ACCOUNT SCREEN

Title:

“Create Account”

Profile photo:

- Circular profile image area.

- Compact size around 76–88px.

- Small edit/add icon.

Fields:

1. Full Name

2. Username

3. Email

4. Number

5. Password

6. Confirm Password

7. PIN

8. Village / Locality (Optional)

9. City

10. State

Use “Number” as the exact label.

Do NOT write:

“WhatsApp Number”

Account type:

- Public

- Private

Use a clean segmented selection/control.

Selected = blue.

Unselected = gray/light.

Terms:

- Compact checkbox.

- Terms & Conditions text.

Bottom:

- Create Account / Continue button.

- Continue with Google option.

The form must remain compact and scroll naturally.

Do NOT add a separate Profile Setup screen after this.

10. WHATSAPP OTP SCREEN

After Create Account:

→ WhatsApp OTP.

Title:

“Verify your number”

Show masked number.

OTP:

- Six separate boxes.

- Each box approximately 44–48px square.

- Rounded corners around 12–14px.

- White solid background.

- Thin border.

- Black entered text.

- Blue focus border.

Behaviour:

- Auto-focus next field.

- Paste six digits.

- Auto-submit after all six digits.

- Resend countdown.

- Change Number.

- Error state.

- Loading state.

After successful verification:

→ DIRECTLY HOME.

There must be NO Profile Setup page here.

11. HOME SCREEN

Use the same ambient background.

TOP HEADER:

Horizontal layout:

[Profile] [Signature Pill] [Notification] [Settings]

Profile icon:

- Approximately 34–38px.

Notification icon:

- Approximately 22px.

Settings icon:

- Approximately 22px.

Signature Pill:

- Long horizontal pill.

- White background.

- Black 1px border.

- Approximately 42–46px height.

- It should occupy the majority of the available horizontal space between the icons.

- Black text.

- Compact internal padding.

Do NOT add a Theme icon.

12. GREETING SURFACE

Create a compact glassmorphism greeting surface.

Text:

“Good Morning, Nithiin”

Inside:

- 5 member slots total.

- First 3 slots can contain member DPs.

- Last 2 slots are Add slots.

DP size:

- Approximately 40–44px.

Add slot:

- Circular light surface.

- Small + icon.

Do not make this greeting surface huge.

13. SEARCH

Place search directly below the greeting surface.

Search input:

- White solid pill.

- Height approximately 44px.

- Thin border.

- Soft shadow.

- Search icon.

- Placeholder:

  “Search people”

Do not use a glass input.

14. QUICK CONNECT

Show three compact controls:

Search People

New Chat

Nearby

Each should be:

- Small.

- Content-sized.

- Rounded.

- Clean.

- Simple icon + label.

Do NOT create three large cards.

15. PEOPLE YOU MAY KNOW

Title:

“People You May Know”

Display approximately 20 mock users.

IMPORTANT:

These are NOT cards.

Each user should be presented directly on the background as a clean compact user item containing:

- DP

- Username

- Name

- Location

- Follow button

Follow button:

- Blue.

- Compact.

- White text.

Following:

- Blue.

Unfollow:

- Gray.

Layout:

- Horizontal continuous/sliding presentation.

- Slow movement.

- Smooth animation.

Interaction:

- Touch/press immediately pauses movement.

- Keep paused briefly after interaction.

- Then resume slowly.

- Tapping a user opens their profile.

No large containers around individual users.

16. RECENT CHATS

Title:

“Recent Chats”

Use direct natural rows.

NO cards.

NO glass rows.

Each row:

- DP approximately 48px.

- Name.

- Last message.

- Last seen.

- Active status.

- Unread count when applicable.

Use clean dividers or spacing instead of cards.

Rows should feel similar to polished WhatsApp/Instagram list layouts.

17. BOTTOM NAVIGATION

Create a floating glassmorphism navigation bar.

Items:

Home

NearBy

Connect

Chat

Settings

Height:

Approximately 58–64px.

Horizontal margins:

Approximately 12–16px.

Bottom spacing:

Respect safe area.

Glass:

- White translucent.

- Subtle blur.

- Thin border.

- Soft shadow.

Icons:

- Approximately 21–23px.

- Labels approximately 10–11px if labels are shown.

Active icon:

- Subtle scale/opacity animation.

- No flashy animation.

18. NAVIGATION

Implement working navigation for the initial flow:

Splash

↓

Login

↓

Create Account

↓

WhatsApp OTP

↓

Home

Home bottom navigation should visually navigate to placeholder versions of:

- Home

- NearBy

- Connect

- Chat

- Settings

Do not fully build those future feature screens yet unless required for navigation placeholders.

19. RESPONSIVE BEHAVIOUR

Mobile is the primary target.

For smaller phones:

- Maintain safe margins.

- Inputs must not overflow.

- Buttons must remain compact.

- Header must remain balanced.

- Signature Pill must shrink gracefully.

- Bottom navigation must remain inside safe area.

For tablets/desktop:

- Do not simply stretch every component to full width.

- Keep the mobile composition visually centered.

- Maintain controlled maximum content width.

20. MOCK DATA

Use realistic mock users and chats.

Example:

- Nithiin

- Akshitha

- Rahul

- Priya

- Arjun

Use realistic:

- names

- usernames

- locations

- messages

- active/last-seen states

No backend is required at this stage.

21. STRICTLY DO NOT ADD

Do NOT add:

- Light mode toggle

- Dark mode

- System theme

- Profile Setup after OTP

- Posts

- Reels

- Stories

- Video sharing

- Video calls

- Public content feed

- Large dashboard cards

- Giant input fields

- Giant buttons

- Glassmorphism inputs

- Glassmorphism everywhere

- Decorative fonts

- Serif fonts

- Handwritten UI fonts

- Neon colors

- Excessive gradients

- Excessive animations

- Unrequested features

FINAL QUALITY RULE

Treat the attached reference images as the visual source of truth for the overall look.

Follow the exact dimensions, spacing, colors, hierarchy and component rules above.

Do not replace these specifications with generic “premium UI” defaults.

The final result must look:

- compact

- clean

- balanced

- modern

- premium

- minimal

- production-ready

Build the UI carefully from the first screen instead of generating a generic template.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ceb91230-aa0a-4a60-80cd-775a323f2224).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
