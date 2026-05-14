/* =============================================================
 * RTS shared configuration — single source of truth for both
 * the Builder and the Validator.
 *
 * Both rts-builder.html and rts-validator.html load this file
 * via <script src="rts-config.js"></script>. They then read
 * globalThis.RTS_CONFIG_YAML and parse it via js-yaml.
 *
 * Editing rules:
 *   - All policy wording lives here. Change it once.
 *   - Question IDs (coi1, fund2, m1, etc.) are addressed by
 *     templates and must remain stable. Renaming an ID will
 *     invalidate any saved drafts referencing it.
 *   - Optional fields use optional: true. Templates may wrap
 *     them in parentheses — e.g. "from {eth3} (ID: {eth4})." —
 *     and the surrounding " ( … )" group collapses to nothing
 *     if the field is blank.
 *   - If a placeholder needs different wording than the default
 *     "[authors to provide …]", set placeholder_full on the
 *     question with the full text inside the brackets.
 *   - Run "node tests/rts-tests.js" after any change to confirm
 *     the validator still recognises every builder output.
 * ============================================================= */

// Use globalThis so the same file works in browsers (window) and Node (tests).
globalThis.RTS_CONFIG_YAML = `sections:

  general_disclosures:
    label: "General Disclosures"
    subsections:

      conflicts_of_interest:
        heading: "Conflicts of interest"
        statement_label: "Conflicts of interest"
        guidance: |
          - A conflict of interest exists when a researcher has financial, personal, or professional relationships that present an actual or perceived threat to the integrity or independence of the research or its publication.
          - All authors must declare any potential conflicts of interest related to the research or manuscript.
          - If there are no conflicts of interest, this must be stated explicitly.
        questions:
          coi1:
            text: "Do any authors have conflicts of interest to report?"
            type: radio
            options:
              - value: "yes"
                label: "Yes"
              - value: "no"
                label: "No"
          coi2:
            text: "Which authors have conflicts of interest to declare?"
            type: radio
            depends_on:
              coi1: "yes"
            options:
              - value: all
                label: "All authors"
              - value: some
                label: "Some authors"
          coi3:
            text: "Please provide a conflict of interest statement that clearly discloses each author's conflicts."
            type: textarea
            depends_on:
              coi1: "yes"
            friendly_placeholder: "your conflicts of interest statement"
        builder:
          type: conditional
          rules:
            - when:
                coi1: "no"
              template: "All authors declare they have no conflicts of interest."
            - when:
                coi1: "yes"
                coi2: all
              template: "{coi3}"
            - when:
                coi1: "yes"
                coi2: some
              template: "{coi3} The other authors declare they have no conflicts of interest."

      funding:
        heading: "Funding"
        statement_label: "Funding"
        guidance: |
          - All authors must declare any sources of funding related to the research or manuscript.
          - Authors should state if any funders had any role in study design, implementation, analysis, reporting or interpretation.
          - If there were no funding sources, this must be stated explicitly.
        questions:
          fund1:
            text: "Do you have any funding sources to declare?"
            type: radio
            options:
              - value: "yes"
                label: "Yes"
              - value: "no"
                label: "No"
          fund2:
            text: "Please provide details about the funding sources."
            type: textarea
            placeholder: 'For example: "This research was funded by Australian Research Council Grant #12345."'
            depends_on:
              fund1: "yes"
            friendly_placeholder: "your funding sources"
          fund3:
            text: "Did any funders have any role in study design, implementation, analysis, reporting or interpretation?"
            type: radio
            depends_on:
              fund1: "yes"
            options:
              - value: "yes"
                label: "Yes"
              - value: "no"
                label: "No"
          fund4:
            text: "Please provide details of the funder's role in the study."
            type: textarea
            depends_on:
              fund3: "yes"
            friendly_placeholder: "the funder's role"
        builder:
          type: conditional
          rules:
            - when:
                fund1: "no"
              template: "This research received no funding."
            - when:
                fund1: "yes"
                fund3: "yes"
              template: "{fund2} {fund4}"
            - when:
                fund1: "yes"
                fund3: "no"
              template: "{fund2} The funders did not have any role in study design, implementation, analysis, reporting or interpretation."
            # Catch-all: show whatever the author has typed in fund2 as
            # soon as they start typing, even before fund3 is answered.
            # Once they answer fund3, one of the more specific rules
            # above takes over. Order matters — this one is last.
            - when:
                fund1: "yes"
              template: "{fund2}"

      artificial_intelligence:
        heading: "Artificial intelligence"
        statement_label: "Artificial intelligence"
        guidance: |
          - Authors must disclose in the Research Transparency Statement whether they used any artificial intelligence (AI) technologies, such as large-language models (e.g., ChatGPT 5.5) during the research or production of the manuscript.
          - The Editors and reviewers will judge whether the use of AI is appropriate.
        questions:
          ai1:
            text: "Were any artificial intelligence technologies used in this research or the creation of this article?"
            type: radio
            options:
              - value: "yes"
                label: "Yes"
              - value: "no"
                label: "No"
          ai2:
            text: "Please provide details of which AI tools were used and for what purpose."
            type: textarea
            placeholder: 'For example: "ChatGPT 5.5 was used to check analysis code for errors."'
            depends_on:
              ai1: "yes"
            friendly_placeholder: "the AI tools used and what they were used for"
        builder:
          type: conditional
          rules:
            - when:
                ai1: "no"
              template: "No artificial intelligence assisted technologies were used in this research or the creation of this article."
            - when:
                ai1: "yes"
              template: "{ai2} No other artificial intelligence assisted technologies were used in this research or the creation of this article."

      ethics:
        heading: "Ethics"
        statement_label: "Ethics"
        guidance: |
          - Authors must say whether the research received ethics approval.
          - Provide the name of the approving body (e.g., ethics board) and the approval ID.
          - If no approval was required, please state this explicitly and provide a justification.
        questions:
          eth1:
            text: "Did your research require ethics approval?"
            type: radio
            options:
              - value: "yes"
                label: "Yes"
              - value: "no"
                label: "No"
          eth2:
            text: "Did the research receive ethics approval from an ethics board?"
            type: radio
            depends_on:
              eth1: "yes"
            options:
              - value: "yes"
                label: "Yes"
              - value: "no"
                label: "No"
          eth3:
            text: "What is the name of the ethics board?"
            type: text
            placeholder: "e.g., the University of Sydney ethics board"
            depends_on:
              eth1: "yes"
              eth2: "yes"
            friendly_placeholder: "the ethics board name"
          eth4:
            text: "What is the application ID number? (if available)"
            type: text
            placeholder: "e.g., 424242"
            optional: true
            depends_on:
              eth1: "yes"
              eth2: "yes"
            friendly_placeholder: "the ethics approval ID"
          eth5:
            text: "Please provide a custom ethics disclosure statement."
            type: textarea
            depends_on:
              eth1: "yes"
              eth2: "no"
            note: "The text you write here will appear directly under the Ethics label in the final statement."
            friendly_placeholder: "your ethics disclosure statement"
          eth6:
            text: "Please explain why the study did not require ethics approval."
            type: textarea
            placeholder: 'For example: "no human participants were involved."'
            depends_on:
              eth1: "no"
            friendly_placeholder: "the reason ethics approval was not required"
            sentence_fragment: true
        builder:
          type: conditional
          rules:
            # Single rule covers both the eth4-present and eth4-absent cases:
            # the renderer collapses " ({eth4})" to "" when eth4 is blank.
            - when:
                eth1: "no"
              template: "This research did not require ethics approval because {eth6}."
            - when:
                eth1: "yes"
                eth2: "yes"
              template: "This research received ethics approval from {eth3} (ID: {eth4})."
            - when:
                eth1: "yes"
                eth2: "no"
              requires: [eth5]
              template: "{eth5}"


study_template:
  subsections:
    preregistration:
      heading: "Preregistration"
      statement_label: "Preregistration"
      guidance: |
        - Preregistration involves specifying study aims, methods, and/or analysis plans before data collection or analysis.
        - Authors should state which core aspects of each study (research aims/hypotheses, methods, analyses) were preregistered or not.
        - Authors should state when aspects of the study were registered relative to data collection/analysis.
        - Authors should state whether there were any deviations from the preregistered plan.
        - Authors should provide a working permalink (e.g., DOI) that leads directly to the preregistration(s).
      builder:
        type: custom_preregistration
      questions:
        q1:
          text: "Is any aspect of the study preregistered?"
          type: radio
          options:
            - value: "no"
              label: "No"
            - value: "yes"
              label: "Yes"
        q2:
          text: "Please provide a direct link to the preregistration."
          type: url
          depends_on:
            q1: "yes"
          validate_url: true
        q3:
          text: "Which aspects of the study were preregistered?"
          type: aspects_table
          depends_on:
            q1: "yes"
          aspects:
            - id: aims
              label: "Aims / Hypotheses"
              term: "aims/hypotheses"
              verb: "were"
            - id: methods
              label: "Methods"
              term: "methods"
              verb: "were"
            - id: analyses
              label: "Analyses"
              term: "analyses"
              verb: "were"
          # The display labels are deliberately shorter than the preview
          # wording. The Builder uses each option's "value" field to drive
          # which aspect goes into which sentence; the preview text still
          # reads "preregistered" / "partly preregistered" / "not preregistered"
          # so the public RTS reads correctly.
          options:
            - value: preregistered
              label: "Fully"
            - value: partly
              label: "Partly"
            - value: not
              label: "Not at all"
        q4:
          text: "At what stage did you preregister?"
          type: radio
          depends_on:
            q1: "yes"
          options:
            - value: before_collection
              label: "Before data collection"
              phrase: "prior to data collection"
            - value: after_collection
              label: "After data collection, but before data access"
              phrase: "after data collection, but before data access"
            - value: after_access
              label: "After data access, but before data analysis"
              phrase: "after data access, but before data analysis"
        q5:
          text: "Were there any deviations from the preregistration?"
          type: radio
          depends_on:
            q1: "yes"
          options:
            - value: "no"
              label: "No"
            - value: "yes"
              label: "Yes"
        q6:
          text: "How would you classify the deviations?"
          type: radio
          depends_on:
            q5: "yes"
          options:
            - value: major
              label: "Major"
              phrase: "major"
            - value: minor
              label: "Minor"
              phrase: "minor"
            - value: both
              label: "Both major and minor"
              phrase: "major and minor"
        q7:
          text: "Where can readers find more information about the deviations?"
          type: checkboxes
          depends_on:
            q5: "yes"
          note: "Select all that apply."
          options:
            - value: main_text
              label: "In the main text"
              requires_location: false
            - value: table
              label: "Preregistration deviation disclosure table"
              requires_location: true
              location_placeholder: "e.g., Supplementary Table 1"
            - value: other
              label: "Other"
              requires_location: true
              location_placeholder: "Please specify location"

    materials:
      heading: "Materials"
      statement_label: "Materials"
      guidance: |
        - Materials refers to a variety of resources necessary for an independent researcher to evaluate and replicate each study. This typically includes stimuli, manipulations, measures, instruments, as well as details of procedures (e.g., instructions to participants, instructions to experimenters and/or confederates, experimenter and/or confederate scripts, instructions to coders, recruitment materials, consent forms) and custom experimental software. In the current context, materials does not include data or analysis scripts, which require separate disclosure statements.
        - Upon submission, Psychological Science requires authors to make all original study materials publicly available in a [trusted online repository](https://docs.google.com/document/d/1Su7oS6-9FYXQ7vgIFxEu_UY_IgsMIjcx1K2FOBwRkAA/edit?usp=sharing), unless there are reasonable constraints.
        - Authors should provide a working permalink (e.g., DOI) that leads directly to the materials.
        - If there are any constraints on full public sharing, authors must provide a justification in the Research Transparency Statement. The editorial team will consider whether to allow transparency exemptions on a case-by-case basis.
        - If authors are using materials from a third party source, they should seek permission to re-share them alongside the current manuscript. If re-sharing is not possible, authors should state this clearly in the Research Transparency Statement and explain how other researchers can obtain the resources by completing a [third-party resource disclosure table](https://docs.google.com/document/d/19_m8xoUKdMcRCOcEm2_nDItBol-chImxEKxVqKA99RQ/edit?usp=sharing). The table should be uploaded to a [trusted repository](https://docs.google.com/document/d/1Su7oS6-9FYXQ7vgIFxEu_UY_IgsMIjcx1K2FOBwRkAA/edit?usp=sharing) and linked from the Research Transparency Statement.
      builder:
        type: branch
        branch_on: m1
        templates:
          all:  "All study materials are publicly available ({m2})."
          some: "Some study materials are publicly available ({m3}) but access to other materials is restricted. {m4}"
          none: "Access to the study materials is restricted. {m5}"
          n_a:  "Not applicable."
      questions:
        m1:
          text: "Are all study materials publicly available?"
          type: radio
          options:
            - value: all
              label: "All study materials are publicly available"
            - value: some
              label: "Only some study materials are publicly available and access to other study materials is restricted"
            - value: none
              label: "Access to all study materials is restricted"
            - value: n_a
              label: "No applicable materials"
              # When this option is chosen, the Builder shows a confirmation
              # modal restating the journal's broad definition of materials.
              confirm:
                title: "Confirm: no applicable materials"
                message: |
                  The journal defines "materials" broadly. They typically include all stimuli, manipulations, measures, or instruments, as well as details of procedures (e.g., instructions to participants, instructions to experimenters and/or confederates, experimenter and/or confederate scripts, instructions to coders, recruitment materials, consent forms) and custom experimental software.

                  Are you sure none of these are applicable to your study?
                ok: "Confirm — none applicable"
                cancel: "Go back"
        m2:
          text: "Please provide a direct link to the materials."
          type: url
          depends_on:
            m1: all
          validate_url: true
          friendly_placeholder: "the materials link"
        m3:
          text: "Please provide a direct link to the materials that are publicly available."
          type: url
          depends_on:
            m1: some
          validate_url: true
          friendly_placeholder: "the public materials link"
        m4:
          text: "Please explain which materials are not publicly available, what the access restrictions are, and a justification for the access restrictions."
          type: textarea
          depends_on:
            m1: some
          placeholder_full: "authors to describe which materials are restricted, the restrictions, and the justification"
        m5:
          text: "Please explain why the materials are not publicly available, what the access restrictions are, and a justification for the access restrictions."
          type: textarea
          depends_on:
            m1: none
          friendly_placeholder: "why the materials aren't public, the restrictions, and the justification"

    data:
      heading: "Data"
      statement_label: "Data"
      guidance: |
        - Data are the recorded observations or measurements collected or generated for the purposes of analysis. *Raw data* refers to the original quantitative or qualitative recordings, e.g., handwriting in a paper questionnaire, responses on a computer keyboard, or physiological readings. *Primary data* refers to the first digital (and if necessary, anonymized) version of the raw data, otherwise unaltered. This includes data that is later excluded from the analysis.
        - Upon submission, Psychological Science requires authors to make all raw/primary research data publicly available in a [trusted repository](https://docs.google.com/document/d/1Su7oS6-9FYXQ7vgIFxEu_UY_IgsMIjcx1K2FOBwRkAA/edit?usp=sharing), unless there are reasonable constraints.
        - Authors should provide a working permalink (e.g., DOI) that leads directly to the data.
        - If there are any constraints on full public sharing, authors must provide a justification in the Research Transparency Statement. The editorial team will consider whether to allow transparency exemptions on a case-by-case basis.
        - If authors are using data from a third party source, they should seek permission to re-share the data alongside the current manuscript. If re-sharing is not possible, authors should state this clearly in the Research Transparency Statement and explain how other researchers can obtain the resources by completing a [third-party resource disclosure table](https://docs.google.com/document/d/19_m8xoUKdMcRCOcEm2_nDItBol-chImxEKxVqKA99RQ/edit?usp=sharing). The table should be uploaded to a [trusted repository](https://docs.google.com/document/d/1Su7oS6-9FYXQ7vgIFxEu_UY_IgsMIjcx1K2FOBwRkAA/edit?usp=sharing) and linked from the Research Transparency Statement.
      builder:
        type: branch
        branch_on: d1
        templates:
          all:  "All primary data are publicly available ({d2})."
          some: "Some primary data are publicly available ({d3}) but access to other primary data is restricted. {d4}"
          none: "Access to the primary data is restricted. {d5}"
      questions:
        d1:
          text: "Are all primary data publicly available?"
          type: radio
          options:
            - value: all
              label: "All primary data are publicly available"
            - value: some
              label: "Only some primary data are publicly available and access to other primary data is restricted"
            - value: none
              label: "Access to all primary data is restricted"
        d2:
          text: "Please provide a direct link to the primary data."
          type: url
          depends_on:
            d1: all
          validate_url: true
          friendly_placeholder: "the data link"
        d3:
          text: "Please provide a direct link to the primary data that are publicly available."
          type: url
          depends_on:
            d1: some
          validate_url: true
          friendly_placeholder: "the public data link"
        d4:
          text: "Please explain which data are not publicly available, what the access restrictions are, and a justification for the access restrictions."
          type: textarea
          depends_on:
            d1: some
          placeholder_full: "authors to describe which data are restricted, the restrictions, and the justification"
        d5:
          text: "Please explain why the data are not publicly available, what the access restrictions are, and a justification for the access restrictions."
          type: textarea
          depends_on:
            d1: none
          friendly_placeholder: "why the data isn't public, the restrictions, and the justification"

    analysis_scripts:
      heading: "Analysis Scripts"
      statement_label: "Analysis scripts"
      guidance: |
        - Analysis scripts completely document all of the steps performed to transform the raw data into the reported results (including reorganizing, filtering, transforming, analyzing, and visualizing the data). Analysis scripts are ideally computational code, but can also be detailed instructions for repeating the analyses in point-and-click software. Authors must share all analysis scripts necessary for an independent researcher to reproduce the results reported in the manuscript.
        - Upon submission, Psychological Science requires authors to make all analysis scripts publicly available in a [trusted repository](https://docs.google.com/document/d/1Su7oS6-9FYXQ7vgIFxEu_UY_IgsMIjcx1K2FOBwRkAA/edit?usp=sharing), unless there are reasonable constraints.
        - Authors should provide a working permalink (e.g., DOI) that leads directly to the analysis scripts.
        - If there are any constraints on full public sharing, authors must provide a justification in the Research Transparency Statement. The editorial team will consider whether to allow transparency exemptions on a case-by-case basis.
        - If authors are using analysis scripts from a third party source, they should seek permission to re-share them alongside the current manuscript. If re-sharing is not possible, authors should state this clearly in the Research Transparency Statement and explain how other researchers can obtain the resources by completing a [third-party resource disclosure table](https://docs.google.com/document/d/19_m8xoUKdMcRCOcEm2_nDItBol-chImxEKxVqKA99RQ/edit?usp=sharing). The table should be uploaded to a [trusted repository](https://docs.google.com/document/d/1Su7oS6-9FYXQ7vgIFxEu_UY_IgsMIjcx1K2FOBwRkAA/edit?usp=sharing) and linked from the Research Transparency Statement.
      builder:
        type: branch
        branch_on: a1
        templates:
          all:  "All analysis scripts are publicly available ({a2})."
          some: "Some analysis scripts are publicly available ({a3}) but access to other analysis scripts is restricted. {a4}"
          none: "Access to the analysis scripts is restricted. {a5}"
      questions:
        a1:
          text: "Are all analysis scripts publicly available?"
          type: radio
          options:
            - value: all
              label: "All analysis scripts are publicly available"
            - value: some
              label: "Only some analysis scripts are publicly available and access to other analysis scripts is restricted"
            - value: none
              label: "Access to all analysis scripts is restricted"
        a2:
          text: "Please provide a direct link to the analysis scripts."
          type: url
          depends_on:
            a1: all
          validate_url: true
          friendly_placeholder: "the analysis-scripts link"
        a3:
          text: "Please provide a direct link to the analysis scripts that are publicly available."
          type: url
          depends_on:
            a1: some
          validate_url: true
          friendly_placeholder: "the public analysis-scripts link"
        a4:
          text: "Please explain which analysis scripts are not publicly available, what the access restrictions are, and a justification for the access restrictions."
          type: textarea
          depends_on:
            a1: some
          # placeholder_full overrides the default "[authors to provide …]"
          # bracket so we can use a different verb ("describe") and article ("a").
          placeholder_full: "authors to describe which scripts are restricted, the restrictions, and a justification"
        a5:
          text: "Please explain why the analysis scripts are not publicly available, what the access restrictions are, and a justification for the access restrictions."
          type: textarea
          depends_on:
            a1: none
          friendly_placeholder: "why the scripts aren't public, the restrictions, and the justification"
defaults:
  num_studies: 1
  max_studies: 5

# =========================================================
# Stage 1 Registered Report (RR) overlay
# Applied to the parsed config when isRR === true.
# Documented as data so both the builder and the validator
# can apply identical transformations.
# =========================================================
rr_overlay:
  general_disclosures:
    artificial_intelligence:
      questions:
        ai1:
          text: "Will any artificial intelligence technologies be used in this research or the creation of this article?"
        ai2:
          text: "Please provide details of which AI tools will be used and for what purpose."
          placeholder: 'For example: "ChatGPT 5.5 will be used to check analysis code for errors."'
      builder:
        type: conditional
        rules:
          - when: { ai1: "no" }
            template: "No artificial intelligence assisted technologies will be used in this research or the creation of this article."
          - when: { ai1: "yes" }
            template: "{ai2} No other artificial intelligence assisted technologies will be used in this research or the creation of this article."
  study:
    preregistration:
      static_text: "The research aims/hypotheses, methods, and analysis plan will be preregistered on the Open Science Framework as a Stage 1 Registered Report with Psychological Science."
      note: "For a Stage 1 Registered Report, the preregistration statement below is automatically included in the preview — no answers needed here."
    data:
      questions:
        d1:
          text: "Will the primary data be made publicly available?"
          options:
            - { value: all,  label: "Yes — all primary data will be publicly available" }
            - { value: some, label: "Only some primary data will be publicly available; access to other primary data will be restricted" }
            - { value: none, label: "Access to all primary data will be restricted" }
        d4:
          text: "Please explain which data will not be publicly available, what the access restrictions will be, and the justification for those restrictions."
        d5:
          text: "Please explain why the data will not be publicly available, what the access restrictions will be, and the justification for those restrictions."
      remove_questions: [d2, d3]
      builder_templates:
        all:  "All primary data will be made publicly available."
        some: "Some primary data will be made publicly available, but access to other primary data will be restricted. {d4}"
        none: "Access to the primary data will be restricted. {d5}"
    analysis_scripts:
      questions:
        a1:
          text: "Will the analysis scripts be made publicly available?"
          options:
            - { value: all,  label: "Yes — all analysis scripts will be publicly available" }
            - { value: some, label: "Only some analysis scripts will be publicly available; access to other analysis scripts will be restricted" }
            - { value: none, label: "Access to all analysis scripts will be restricted" }
        a4:
          text: "Please explain which analysis scripts will not be publicly available, what the access restrictions will be, and the justification for those restrictions."
        a5:
          text: "Please explain why the analysis scripts will not be publicly available, what the access restrictions will be, and the justification for those restrictions."
      remove_questions: [a2, a3]
      builder_templates:
        all:  "All analysis scripts will be made publicly available."
        some: "Some analysis scripts will be made publicly available, but access to other analysis scripts will be restricted. {a4}"
        none: "Access to the analysis scripts will be restricted. {a5}"
`;

// Node compatibility — let the test suite require this file.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { yaml: globalThis.RTS_CONFIG_YAML };
}
