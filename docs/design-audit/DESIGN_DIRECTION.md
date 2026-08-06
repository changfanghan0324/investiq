# Codex design direction before independent review

## Product stance

InvestIQ should read as a calm research workspace: light-first, editorial,
institutional, and explicit about evidence. The redesign is visual subtraction
and progressive disclosure, not a new feature set or a new financial model.

## Proposed system

- Use the operating-system sans stack for all ordinary interface and document
  text. Reserve mono for tickers, accessions, CIKs, transaction IDs, and code.
- Use a cool neutral page background, white working surfaces, graphite text, and
  one muted navy accent. Semantic green, red, and ochre retain financial meaning.
- Use whitespace, alignment, thin rules, and table rows for hierarchy. Restrict
  bordered surfaces to the task form and the primary result surface.
- Use radii of 4–8 px, one subtle shadow at most, no gradients, no glow, no blur,
  and no infinite animation.
- Remove decorative icons and retain only icons that communicate an action or
  state. Text links are the default secondary action.

## Information architecture

- Global shell: one 56–60 px white header with Company Research, Compare,
  Portfolio, Tools, language, and text size. Mobile retains only the brand and
  display controls above four equal bottom-navigation items.
- Home: search-first hero, concise data-truth definition list, three text-based
  research entries, and a compact owner footer.
- Company research: document heading, filing basis, four key metrics, a short
  reported-change summary, and clear financials/valuation links. Receipts and
  formulas move into details without being removed.
- Compare and Portfolio: basic task form first; advanced assumptions closed;
  results summarized in one table or four metrics; methodology follows results.
- DCA: one holding and three numbered setup sections on the left; an empty or
  completed result area on the right; one mode-specific primary CTA; advanced
  fee/tax/order assumptions closed; explanation and export only after results.
- Tools, About, and Case Study: editorial lists and research-document layouts,
  not card grids.

## Financial-confidence safeguards

- Keep every calculation, selection rule, guardrail, data mode, source receipt,
  and export disclosure intact.
- Never turn unavailable values into zero or imply synthetic market history is
  real.
- Keep disclosures near the action and in generated exports, while moving long
  methodology explanations behind accessible details.
- Keep one visually dominant chart per view; secondary charts remain available
  through tabs or details.

## Review questions for Claude

1. Which existing elements create the strongest AI-template or crypto-terminal
   impression?
2. Which visible controls should be basic, advanced, result-only, or removed from
   the initial view?
3. Does the proposed subtraction risk hiding evidence or weakening financial
   credibility?
4. What copy, type, spacing, or navigation choices still feel artificial?
5. What would a non-finance user and a recruiter misunderstand in the first five
   and thirty seconds respectively?
