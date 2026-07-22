# Pack 3 Schema Design Report

These schemas are draft, technology-neutral business contracts generated from the revised Pack 3 Markdown candidates and the approved Pack 3 Governed Decision Register.

## Key modelling choices

- Service is a durable reusable offering.
- Service Arrangement is the OPLOC-specific way a Service is provided.
- Recurring Schedule owns repeating planned delivery patterns and exceptions.
- Requested Work Input preserves demand classification without adopting the unresolved final name of the shared fulfilment record.
- Event, Equipment, Production and Training remain separate domains referenced by Service schemas without transferring ownership.
- Commercial ownership is role-based through AUTHMOD and never assigned to named individuals.

## Deferred concepts

- Service Family and Service Template remain unresolved.
- The final canonical name of the shared fulfilment/work record remains unresolved.
- Product and OPEXP are not adopted here.
