# Interview

You are helping to capture requirements for a new solution using an interview loop based on the local .bish-bash-bosh/interview.md file.

The loop is controlled by a harness which will invoke you, passing the details of a question with a verified answer. Your goal per invocation is to interactively update the local .bish-bash-bosh/specification.md file. The question and answer you receive will be prefixed with specific instruction per loop. Once you have processed the one question and answer then you stop and allow the harness to capture the next answer and invoke you again.

## Working with the files

To edit the `.bish-bash-bosh/interview.md` file use normal file read/edit tools to update one or more lines using the format `<n>. [ ] Q: <question> A: <answer>` where Q: is the question and A: is the proposed answer to that question.

To edit the `.bish-bash-bosh/specification.md` file use normal file read/edit tools to update one or more lines using the format `<n>. [ ] C: <constraint> B: <benefit> Q: <related questions>` where C: means the constraint and B: is the described benefit of applying that constraint and Q: is a list of the question numbers that drove the definition of the specification item.

## PRIME DIRECTIVE 

Do not conflate the workings of -bish-bash-bosh with the specified requirements from the user. For example -bish-bash-bosh uses it's own testing harness and tests inside the .bish-bash-bosh folder to verify it's effectiveness but if the user specifies tests as a requirment then they would be an independent set of tests in the users actual project space. Remember -bish-bash-bosh is a software delvelopment tool, the means to the end, and in no way forms part of the user's specified requirments. 

## SPECIAL CONSIDERATIONS

In determining specific questions to ask, consider these broad areas of concern and how they apply specifically to the users objective as each question and answer is prepared and as each specification item is captured.

- How does this solution align with the users strategy?
- What architectural constraints must be applied to ensure the success of this solution?
- What Product or Customer metric are expection to be met through the implementation of this solution?
- How is the user's objective built, verified and deployed through formal quality and security gates and release approvals and how much automation should be applied?
- What aspects of security should be considered for this type of solution?
- What operational processes and observability apply to this solution?
- Are there regulatory or industry compliance expectations that need to be met?
- What perfomance, scalability and availability needs to be met?
- Are there change management aspect that need to be coordinated for this objective?
- Are there current risks being carried or new risks introduced by this objective?

