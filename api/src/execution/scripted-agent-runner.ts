import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunner,
  type AgentRunOutcome,
  type AgentRunRequest,
} from './agent-runner';
import { ClaudeAgentRunner } from './claude-agent-runner';
import { DemoScriptRegistry } from './demo-script.registry';
import { AgentRunFailedError } from './execution.errors';

/**
 * The runner the rest of the module actually gets: a scripted outcome when the
 * demo-seed work registered one for this exact definition and input, and the
 * real Claude call otherwise.
 *
 * ## ⚠️ This substitutes the model call, not the record
 *
 * `ExecutionService` depends on the `AgentRunner` port and cannot tell which
 * implementation it received. That is the entire design (research R4): a
 * scripted run is written by the same code as a live one, so its `runs` row is
 * indistinguishable in shape — same trace, same timings, same conformance
 * answer, same state move — and a scripted **failure** throws the same
 * `AgentRunFailedError` a real crash throws, so it travels the ordinary failure
 * path to `state = 'failed'` with `runs.output IS NULL`.
 *
 * That last point is the one `docs/specs/API-11-demo-seed.md` insists on: Act
 * 3's crash must land as real non-delivery evidence, because the absence of an
 * output *is* what Guardian reads. A branch inside the service — `if (isDemo)
 * writeFailedRow()` — would put the shortcut upstream of the evidence and hollow
 * out the closing act while appearing to work.
 *
 * ## ⚠️ An empty registry changes nothing
 *
 * Until fixtures are registered, every lookup misses and every run is live. This
 * class is a pass-through by default, not a mode.
 *
 * ## The demo is honest about what is scripted
 *
 * Only the seeded agents' own behaviour. The platform's instrumentation, the
 * chain calls, the state machine, and Guardian's audit all run for real against
 * the resulting evidence (`docs/product-workflow.md` §5.5).
 */
@Injectable()
export class ScriptedAgentRunner extends AgentRunner {
  private readonly logger = new Logger(ScriptedAgentRunner.name);

  constructor(
    private readonly scripts: DemoScriptRegistry,
    private readonly live: ClaudeAgentRunner,
  ) {
    super();
  }

  async run(request: AgentRunRequest): Promise<AgentRunOutcome> {
    const matched = this.scripts.lookup(request.definitionHash, request.input);

    // The normal case for every real purchase, and the only case while the
    // registry is empty.
    if (matched === null) return this.live.run(request);

    this.logger.log(
      `order=${request.orderId} demo script fired: ${matched.label} (${matched.script.kind})`,
    );

    if (matched.script.kind === 'failure') {
      // The same error a real crash produces. `ExecutionService` has no way to
      // tell the difference, which is what makes the resulting evidence real.
      throw new AgentRunFailedError(
        matched.script.message,
        request.orderId,
      );
    }

    return {
      output: matched.script.output,
      // A scripted run has no model prose. `null` rather than an invented
      // sentence: `ExecutionStep.reasoning` means "what the model said", and
      // fabricating it would put a lie in the field an auditor reads to judge
      // whether the agent genuinely tried.
      assistantText: null,
      // A scripted call takes no measurable time and does not pretend to. The
      // run's own `duration_ms` is still real wall clock measured by the
      // service, so the record does not claim the work was instantaneous.
      durationMs: 0,
    };
  }
}
