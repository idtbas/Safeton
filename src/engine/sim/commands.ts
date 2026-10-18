/**
 * Command dispatcher — the only way state changes from outside the tick loop. GUI, terminal
 * and automation all go through these handlers, so their behaviour is identical.
 */
import { applySwitchFault, injectFault, repairNodeHardware, restoreSwitch } from './failures';
import { cancelJob, handleNodeLost, submitJob } from './jobs';
import type { Simulation } from './simulation';
import { GpuHealth, NodeState, type Command, type CommandResult, type NodeSelector } from './types';

const fail = (code: string, message: string): CommandResult => ({ ok: false, error: { code, message } });

function resolveNodes(sim: Simulation, sel: NodeSelector): number[] | CommandResult {
  if (sel === 'all') return sim.topo.nodes.map((n) => n.idx);
  if (Array.isArray(sel)) {
    const out: number[] = [];
    for (const ref of sel) {
      const i = sim.resolveNode(ref);
      if (i === null) return fail('NODE_NOT_FOUND', `Unknown node "${String(ref)}"`);
      out.push(i);
    }
    if (out.length === 0) return fail('NO_TARGETS', 'No nodes selected');
    return [...new Set(out)];
  }
  if ('rack' in sel) {
    const r = sim.rackIndex.get(sel.rack);
    if (r === undefined) return fail('RACK_NOT_FOUND', `Unknown rack "${sel.rack}"`);
    const rack = sim.topo.racks[r]!;
    if (rack.nodeCount === 0) return fail('NO_TARGETS', `Rack ${sel.rack} contains no compute nodes`);
    return Array.from({ length: rack.nodeCount }, (_, k) => rack.nodeStart + k);
  }
  const hall = sim.topo.halls.findIndex((h) => h.id === sel.hall);
  if (hall < 0) return fail('HALL_NOT_FOUND', `Unknown hall "${sel.hall}"`);
  return sim.topo.nodes.filter((n) => n.hallIdx === hall).map((n) => n.idx);
}

function summary(action: string, done: number, skipped: string[]): CommandResult {
  if (done === 0 && skipped.length > 0) return fail('NOTHING_TO_DO', `${action}: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? ` (+${skipped.length - 3} more)` : ''}`);
  return {
    ok: true,
    message: `${action}: ${done} node${done === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} skipped` : ''}`,
    data: { done, skipped },
  };
}

const RUNNING_STATES: readonly number[] = [NodeState.Online, NodeState.Degraded, NodeState.Draining];

export function executeCommand(sim: Simulation, cmd: Command): CommandResult {
  const n = sim.rt.nodes;
  switch (cmd.type) {
    case 'sim.setFailureRate': {
      if (!Number.isFinite(cmd.multiplier) || cmd.multiplier < 0 || cmd.multiplier > 1000) {
        return fail('VALUE_OUT_OF_RANGE', 'Failure-rate multiplier must be between 0 and 1000');
      }
      sim.failureRateMultiplier = cmd.multiplier;
      sim.emit('notice', 'system', 'simulation', 'SIM_FAILURE_RATE', `Failure-rate multiplier set to ${cmd.multiplier}×`);
      return { ok: true, message: `Failure-rate multiplier ${cmd.multiplier}×` };
    }
    case 'sim.setAutoRemediation': {
      sim.autoRemediation = cmd.enabled;
      sim.emit('notice', 'system', 'simulation', 'SIM_REMEDIATION', `Automated remediation ${cmd.enabled ? 'enabled' : 'disabled'}`);
      return { ok: true, message: `Automated remediation ${cmd.enabled ? 'enabled' : 'disabled'}` };
    }

    case 'node.powerOn': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      const skipped: string[] = [];
      let done = 0;
      for (const i of nodes) {
        const s = n.state[i]!;
        const host = sim.topo.nodes[i]!.hostname;
        if (n.powered[i]) skipped.push(`${host} already powered`);
        else if (s === NodeState.Maintenance) skipped.push(`${host} in maintenance`);
        else {
          sim.powerOnNode(i);
          done++;
        }
      }
      return summary('Power on', done, skipped);
    }

    case 'node.powerOff':
    case 'node.reboot': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      const reboot = cmd.type === 'node.reboot';
      const skipped: string[] = [];
      let done = 0;
      for (const i of nodes) {
        const host = sim.topo.nodes[i]!.hostname;
        const s = n.state[i]!;
        const job = n.job[i]!;
        if (job >= 0 && !cmd.force) {
          skipped.push(`${host} runs job ${job} (drain first or force)`);
          continue;
        }
        if (s === NodeState.Maintenance) {
          skipped.push(`${host} in maintenance`);
          continue;
        }
        if (job >= 0) handleNodeLost(sim, job, i, `node ${reboot ? 'rebooted' : 'powered off'} by operator`);
        if (!n.powered[i]) {
          if (reboot) {
            sim.powerOnNode(i);
            done++;
          } else skipped.push(`${host} already off`);
          continue;
        }
        if (s === NodeState.Failed || s === NodeState.Post || s === NodeState.Booting) {
          // Hung or not yet booted: hard power cycle via BMC.
          n.powered[i] = 0;
          if (reboot) sim.powerOnNode(i);
          else sim.setNodeState(i, NodeState.Offline);
          sim.emit('notice', 'node', host, reboot ? 'NODE_POWER_CYCLE' : 'NODE_POWER_OFF_HARD', reboot ? 'BMC chassis power cycle' : 'BMC chassis power off (hard)');
          done++;
          continue;
        }
        if (s === NodeState.ShuttingDown) {
          if (reboot) n.afterShutdown[i] = 1;
          skipped.push(`${host} already shutting down`);
          continue;
        }
        n.afterShutdown[i] = reboot ? 1 : 0;
        sim.setNodeState(i, NodeState.ShuttingDown, sim.topo.nodes[i]!.cfg.platform.boot.shutdownSeconds.v);
        sim.emit('info', 'node', host, reboot ? 'NODE_REBOOT' : 'NODE_SHUTDOWN', reboot ? 'Reboot requested (systemctl reboot)' : 'Graceful shutdown requested (systemctl poweroff)');
        done++;
      }
      return summary(reboot ? 'Reboot' : 'Power off', done, skipped);
    }

    case 'node.drain': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      let done = 0;
      const skipped: string[] = [];
      for (const i of nodes) {
        const host = sim.topo.nodes[i]!.hostname;
        if (n.drain[i]) {
          skipped.push(`${host} already drained`);
          continue;
        }
        n.drain[i] = 1;
        if (n.state[i] === NodeState.Online || n.state[i] === NodeState.Degraded) sim.setNodeState(i, NodeState.Draining);
        sim.emit('notice', 'node', host, 'NODE_DRAIN', `Node drained${cmd.reason ? `: ${cmd.reason}` : ''}${n.job[i]! >= 0 ? ` — job ${n.job[i]} continues until completion` : ''}`);
        done++;
      }
      return summary('Drain', done, skipped);
    }

    case 'node.resume': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      let done = 0;
      const skipped: string[] = [];
      for (const i of nodes) {
        const host = sim.topo.nodes[i]!.hostname;
        if (!n.drain[i]) {
          skipped.push(`${host} not drained`);
          continue;
        }
        n.drain[i] = 0;
        if (n.state[i] === NodeState.Draining) {
          sim.setNodeState(i, NodeState.Online);
          sim.refreshNodeFaults(i);
        }
        sim.emit('info', 'node', host, 'NODE_RESUME', 'Node returned to service (undrain)');
        done++;
      }
      return summary('Resume', done, skipped);
    }

    case 'node.maintenance': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      let done = 0;
      const skipped: string[] = [];
      for (const i of nodes) {
        const host = sim.topo.nodes[i]!.hostname;
        const s = n.state[i]!;
        if (cmd.enter) {
          if (s === NodeState.Maintenance) {
            skipped.push(`${host} already in maintenance`);
            continue;
          }
          const job = n.job[i]!;
          if (job >= 0 && !cmd.force) {
            skipped.push(`${host} runs job ${job} (drain first or force)`);
            continue;
          }
          if (job >= 0) handleNodeLost(sim, job, i, 'node taken into maintenance');
          n.drain[i] = 1;
          if (n.powered[i] && (RUNNING_STATES.includes(s) || s === NodeState.Post || s === NodeState.Booting)) {
            n.afterShutdown[i] = 2;
            sim.setNodeState(i, NodeState.ShuttingDown, sim.topo.nodes[i]!.cfg.platform.boot.shutdownSeconds.v);
          } else if (s === NodeState.ShuttingDown) {
            n.afterShutdown[i] = 2;
          } else {
            n.powered[i] = 0;
            sim.setNodeState(i, NodeState.Maintenance);
            sim.emit('notice', 'node', host, 'NODE_MAINTENANCE', 'Node placed in maintenance');
          }
          done++;
        } else {
          if (s !== NodeState.Maintenance) {
            skipped.push(`${host} not in maintenance`);
            continue;
          }
          n.drain[i] = 0;
          sim.emit('info', 'node', host, 'NODE_MAINTENANCE_EXIT', 'Maintenance complete — returning node to service');
          sim.powerOnNode(i);
          done++;
        }
      }
      return summary(cmd.enter ? 'Enter maintenance' : 'Exit maintenance', done, skipped);
    }

    case 'node.repair': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      let done = 0;
      const skipped: string[] = [];
      for (const i of nodes) {
        const host = sim.topo.nodes[i]!.hostname;
        const s = n.state[i]!;
        const node = sim.topo.nodes[i]!;
        let needsDowntime = n.nicDownMask[i]! !== 0 || n.dimmFault[i] === 1 || n.nvswitchFault[i] === 1;
        for (let k = 0; k < node.cfg.gpuCount; k++) {
          if (sim.rt.gpus.health[node.gpuStart + k]! === GpuHealth.Failed) needsDowntime = true;
        }
        if (needsDowntime && n.powered[i]) {
          skipped.push(`${host}: GPU, NIC, DIMM or baseboard replacement requires maintenance (powered off)`);
          continue;
        }
        const replaced = repairNodeHardware(sim, i);
        sim.tickets = sim.tickets.filter((t) => !(['node', 'psu', 'fan', 'nic', 'nvme'].includes(t.kind) && t.target === i));
        if (replaced.length === 0) {
          skipped.push(`${host}: no failed components`);
          continue;
        }
        if (s !== NodeState.Maintenance && s !== NodeState.Offline && s !== NodeState.Failed) sim.refreshNodeFaults(i);
        sim.emit('notice', 'node', host, 'NODE_REPAIRED', `Replaced ${replaced.join(', ')}`);
        done++;
      }
      return summary('Repair', done, skipped);
    }

    case 'node.setPowerLimit': {
      const nodes = resolveNodes(sim, cmd.nodes);
      if (!Array.isArray(nodes)) return nodes;
      const cfg = sim.topo.nodes[nodes[0]!]!.cfg;
      const min = cfg.gpu.power.minPowerLimitW.v;
      const max = cfg.gpu.power.tdpW.v;
      if (!Number.isFinite(cmd.watts) || cmd.watts < min || cmd.watts > max) {
        return fail('VALUE_OUT_OF_RANGE', `Power limit for ${cfg.gpu.name} must be ${min}–${max} W`);
      }
      for (const i of nodes) {
        const node = sim.topo.nodes[i]!;
        for (let k = 0; k < node.cfg.gpuCount; k++) sim.rt.gpus.powerLimitW[node.gpuStart + k] = cmd.watts;
      }
      sim.emit('notice', 'system', 'power', 'GPU_POWER_LIMIT', `GPU power limit set to ${cmd.watts} W on ${nodes.length} node(s) (nvidia-smi -pl ${cmd.watts})`);
      return { ok: true, message: `Power limit ${cmd.watts} W on ${nodes.length} node(s)` };
    }

    case 'switch.setAdminState':
    case 'switch.repair': {
      const ids: number[] = [];
      for (const ref of cmd.switches) {
        const s = typeof ref === 'number' ? ref : sim.switchIndex.get(ref);
        if (s === undefined || s < 0 || s >= sim.topo.switches.length) return fail('SWITCH_NOT_FOUND', `Unknown switch "${String(ref)}"`);
        ids.push(s);
      }
      for (const s of ids) {
        if (cmd.type === 'switch.repair') {
          if (sim.rt.switches.failed[s]) restoreSwitch(sim, s, false);
          sim.tickets = sim.tickets.filter((t) => !(t.kind === 'switch' && t.target === s));
        } else if (cmd.up) restoreSwitch(sim, s, true);
        else if (sim.rt.switches.adminUp[s]) applySwitchFault(sim, s, true);
      }
      return { ok: true, message: `${cmd.type === 'switch.repair' ? 'Repaired' : cmd.up ? 'Enabled' : 'Disabled'} ${ids.length} switch(es)` };
    }

    case 'fault.inject':
      return injectFault(sim, cmd.target);

    case 'facility.setSetpoint': {
      const hall = sim.halls[cmd.hall];
      const info = sim.topo.halls[cmd.hall];
      if (!hall || !info) return fail('HALL_NOT_FOUND', `Unknown hall index ${cmd.hall}`);
      if (cmd.airSupplyC !== undefined) {
        if (cmd.airSupplyC < 15 || cmd.airSupplyC > 32) return fail('VALUE_OUT_OF_RANGE', 'Supply air setpoint must be 15–32 °C (ASHRAE A1 allowable)');
        hall.airSetpointC = cmd.airSupplyC;
      }
      if (cmd.liquidSupplyC !== undefined) {
        if (!info.liquidUnit) return fail('NO_LIQUID_LOOP', `${info.name} has no liquid cooling loop`);
        if (cmd.liquidSupplyC < 17 || cmd.liquidSupplyC > 45) return fail('VALUE_OUT_OF_RANGE', 'Coolant supply setpoint must be 17–45 °C');
        hall.liquidSetpointC = cmd.liquidSupplyC;
      }
      sim.emit('notice', 'hall', info.id, 'SETPOINT_CHANGED', `${info.name}: setpoints air ${hall.airSetpointC} °C${info.liquidUnit ? `, coolant ${hall.liquidSetpointC} °C` : ''}`);
      return { ok: true, message: `Setpoints updated for ${info.name}` };
    }

    case 'facility.repairAll': {
      for (const h of sim.halls) {
        h.airUnitsFailed = 0;
        h.liquidUnitsFailed = 0;
      }
      sim.plant.chillersFailed = 0;
      sim.tickets = sim.tickets.filter((t) => !['air-unit', 'liquid-unit', 'chiller'].includes(t.kind));
      sim.emit('notice', 'facility', 'plant', 'FACILITY_REPAIRED', 'All cooling plant equipment returned to service');
      return { ok: true, message: 'Facility equipment repaired' };
    }

    case 'job.submit':
      return submitJob(sim, cmd.job);
    case 'job.cancel':
      return cancelJob(sim, cmd.jobId);
    case 'job.setRequestRate': {
      const job = sim.jobs.get(cmd.jobId);
      if (!job) return fail('JOB_NOT_FOUND', `Job ${cmd.jobId} not found`);
      if (job.spec.kind !== 'inference') return fail('JOB_NOT_INFERENCE', `Job ${cmd.jobId} is not an inference service`);
      if (!Number.isFinite(cmd.requestRate) || cmd.requestRate < 0) return fail('VALUE_OUT_OF_RANGE', 'Request rate must be ≥ 0');
      job.spec.requestRate = cmd.requestRate;
      sim.emit('info', 'job', String(job.id), 'JOB_LOAD_CHANGED', `Job ${job.id}: offered load set to ${cmd.requestRate} req/s`);
      return { ok: true, message: `Request rate ${cmd.requestRate} req/s` };
    }
  }
}
