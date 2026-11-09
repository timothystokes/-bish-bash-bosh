# Plan

This is a plan organised into phases of implementation. Each item is numbered and lists the numbers of the items that must be completed before it (`Depends`), or `None`. The plan is defined using a Mermaid Gantt chart (one section per phase, one task per item, `Depends` as `after` links, durations estimated in minutes), which must always mirror the numbered items below. Each item's `Task:` starts with its chart short name, then ` - ` and the detail.

```mermaid
gantt
    title Plan
    dateFormat YYYY-MM-DD HH:mm
    axisFormat %H:%M
    section High Level Design Phase
    Establish architectural constraints :t1, {{TODAY}} 00:00, 5m
```

## High Level Design Phase

1. [ ] Phase: High Level Design Task: Establish architectural constraints - Establish architectural constraints. Depends: None
