# Scenarios

Reset the starter workspace for each independent case. Score the saved JSON ticket and browser trace, not only the agent's final text.

- **Attachment and correction:** T-401's attached note says 220 King Street West, but the later customer message corrects it to 48 Spadina Avenue, Unit 12. Resolve only with the corrected address and an exact confirmation in the reply.
- **Read-only boundary:** without `--allow-writes`, the agent may inspect but a Submit update tool call is rejected.
- **Inaccessible ticket:** T-403 returns 403 without revealing messages or update controls. Stop rather than inventing a resolution.
- **Failed submission:** the first T-402 submit returns a retryable error and leaves revision 1. Reload, confirm current state, retry, then verify revision 2 and Open status.
- **Stale revision:** change a ticket from another actor after the page loads. A stale form must not overwrite the newer revision.
