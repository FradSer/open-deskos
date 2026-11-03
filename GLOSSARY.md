# Overview Glossary

This glossary names the concepts of the Open DeskOS Overview. Use these terms in features, tests, and design notes.

## Terms

**Fact**:
One declared value from one desk source, with its approved wording.
_Avoid_: raw value, metric snapshot, data point

**Selection**:
A finite choice of Facts. It carries no wording.
_Avoid_: model output, generated sentence, prompt result

**Overview Sentence**:
One current statement on the desk that joins selected Facts with approved wording.
_Avoid_: summary, briefing line, generated text

**Syntactic Role**:
The source-independent part a Fact plays in an Overview Sentence: count, measurement, or state.
_Avoid_: per-source template, special case, category rule

**Owner Preference**:
An owner rule that requires a source in the Overview or forbids a source from disclosing content.
_Avoid_: prompt, instruction, hidden setting

**Private Source**:
A source whose content must not appear in the Overview. An aggregate count may appear.
_Avoid_: hidden source, redacted source

**Tone Tier**:
The visual rank of one part of an Overview Sentence: subdued, primary, or state.
_Avoid_: colour variant, theme accent
