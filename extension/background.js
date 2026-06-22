// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "LEETCODE_SUBMISSION") {
        handleSubmission(request.data)
            .then(() => sendResponse({ success: true }))
            .catch((error) => {
                console.error("Submission error:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }
});

async function getCredentials() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['githubToken', 'githubUsername', 'githubRepo'], (res) => {
            if (res.githubToken && res.githubUsername && res.githubRepo) {
                resolve(res);
            } else {
                reject(new Error("GitHub credentials not configured in extension popup."));
            }
        });
    });
}

// GitHub API Helper
async function githubAPI(endpoint, method = 'GET', body = null, token) {
    const options = {
        method,
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`https://api.github.com${endpoint}`, options);
    if (!res.ok) {
        let errStr = "";
        try { const errJson = await res.json(); errStr = JSON.stringify(errJson); } catch(e){}
        throw new Error(`GitHub API Error: ${res.status} ${res.statusText} ${errStr}`);
    }
    // Handle 204 No Content
    if (res.status === 204) return null;
    return await res.json();
}

function getFileExtension(lang) {
    const langMap = {
        'python': 'py', 'python3': 'py', 'java': 'java', 'cpp': 'cpp', 'c': 'c',
        'javascript': 'js', 'typescript': 'ts', 'csharp': 'cs', 'ruby': 'rb',
        'swift': 'swift', 'golang': 'go', 'scala': 'scala', 'kotlin': 'kt',
        'rust': 'rs', 'php': 'php', 'mysql': 'sql', 'oracle': 'sql', 'mssql': 'sql'
    };
    return langMap[lang.toLowerCase()] || 'txt';
}

function generateChartUrl(topicCounts) {
    // topicCounts: { "Array": 5, "Hash Table": 3, ... }
    const labels = Object.keys(topicCounts);
    const data = Object.values(topicCounts);

    if (labels.length === 0) return "";

    const chartConfig = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Problems Solved',
                data: data,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgb(54, 162, 235)',
                borderWidth: 1
            }]
        },
        options: {
            title: { display: true, text: 'Topics Mastered' },
            legend: { display: false },
            scales: {
                yAxes: [{ ticks: { beginAtZero: true, stepSize: 1 } }]
            }
        }
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encodedConfig}`;
}

async function handleSubmission(data) {
    const creds = await getCredentials();
    const repoPath = `/repos/${creds.githubUsername}/${creds.githubRepo}`;

    // 1. Get latest commit and tree
    const ref = await githubAPI(`${repoPath}/git/ref/heads/master`, 'GET', null, creds.githubToken).catch(
        // fallback to main if master doesn't exist
        () => githubAPI(`${repoPath}/git/ref/heads/main`, 'GET', null, creds.githubToken)
    );
    const branch = ref.ref.replace('refs/heads/', '');
    const latestCommitSha = ref.object.sha;

    const latestCommit = await githubAPI(`${repoPath}/git/commits/${latestCommitSha}`, 'GET', null, creds.githubToken);
    const baseTreeSha = latestCommit.tree.sha;

    // 2. Get current stats.json (if exists) to update
    let currentStats = {
        leetcode: { easy: 0, medium: 0, hard: 0, shas: {}, solved: 0 },
        topicCounts: {} // New field to track topics
    };

    try {
        const statsFile = await githubAPI(`${repoPath}/contents/stats.json?ref=${branch}`, 'GET', null, creds.githubToken);
        const statsContent = decodeURIComponent(escape(atob(statsFile.content)));
        currentStats = JSON.parse(statsContent);
        if (!currentStats.topicCounts) currentStats.topicCounts = {};
    } catch (e) {
        console.log("stats.json not found or parse error, initializing new stats.");
    }

    const diffLevel = data.problem.difficulty.toLowerCase();

    // Determine folder name
    const folderName = `${data.problem.id.padStart(4, '0')}-${data.problem.slug}`;

    // Update stats logic
    // Let's only increment if it's a new problem (not in shas)
    const isNewProblem = !currentStats.leetcode.shas[folderName];

    if (isNewProblem) {
        currentStats.leetcode[diffLevel] = (currentStats.leetcode[diffLevel] || 0) + 1;
        currentStats.leetcode.solved++;
        currentStats.leetcode.shas[folderName] = { difficulty: diffLevel };

        // Update topic counts
        data.problem.topics.forEach(topic => {
            currentStats.topicCounts[topic] = (currentStats.topicCounts[topic] || 0) + 1;
        });
    }

    // 3. Prepare new files contents
    // A. Problem README.md
    const problemReadmeContent = `# [${data.problem.title}](https://leetcode.com/problems/${data.problem.slug})\n\n` +
                                 `**Difficulty:** ${data.problem.difficulty}\n\n` +
                                 `${data.problem.content}\n\n` +
                                 `---\n\n` +
                                 `**Topics:** ${data.problem.topics.join(', ')}\n\n` +
                                 `**Runtime:** ${data.runtime} | **Memory:** ${data.memory}\n`;

    // B. Problem Solution Code
    const lang = data.lang || 'java';
    const fileExt = getFileExtension(lang);
    const solutionFileName = `${folderName}.${fileExt}`;
    const solutionContent = data.code;

    // C. Root README.md
    // We construct the root README with the chart
    let rootReadmeContent = `# LeetCode Progress\n\n`;
    rootReadmeContent += `A collection of LeetCode questions to ace the coding interview! - Automated via Auto LeetCode Submitter.\n\n`;

    const chartUrl = generateChartUrl(currentStats.topicCounts);
    if (chartUrl) {
        rootReadmeContent += `## Topics Mastered Graph\n\n![Topics Graph](${chartUrl})\n\n`;
    }

    // Instead of destroying everything, let's just make a simple list of topics
    // If the user wants to customize the README, they can, but the graph is the main feature.
    rootReadmeContent += `<!---LeetCode Topics Start-->\n# LeetCode Topics\n`;
    for (const [topic, count] of Object.entries(currentStats.topicCounts)) {
        rootReadmeContent += `## ${topic}\n`;
        rootReadmeContent += `Total Solved: ${count}\n\n`;
    }
    rootReadmeContent += `<!---LeetCode Topics End-->\n`;

    // 4. Create blobs for all files
    const createBlob = async (content) => {
        const res = await githubAPI(`${repoPath}/git/blobs`, 'POST', {
            content: btoa(unescape(encodeURIComponent(content))),
            encoding: 'base64'
        }, creds.githubToken);
        return res.sha;
    };

    const problemReadmeSha = await createBlob(problemReadmeContent);
    const solutionSha = await createBlob(solutionContent);
    const statsSha = await createBlob(JSON.stringify(currentStats, null, 2));
    const rootReadmeSha = await createBlob(rootReadmeContent);

    // Update shas in stats for tracking files (optional, but mimics original LeetHub)
    currentStats.leetcode.shas[folderName] = {
         ...currentStats.leetcode.shas[folderName],
         "README.md": problemReadmeSha,
         [solutionFileName]: solutionSha
    };
    currentStats.leetcode.shas["README.md"] = { "": rootReadmeSha };

    // Re-create stats blob with updated shas
    const finalStatsSha = await createBlob(JSON.stringify(currentStats, null, 2));

    // 5. Create new tree
    const tree = [
        {
            path: `${folderName}/README.md`,
            mode: '100644',
            type: 'blob',
            sha: problemReadmeSha
        },
        {
            path: `${folderName}/${solutionFileName}`,
            mode: '100644',
            type: 'blob',
            sha: solutionSha
        },
        {
            path: 'stats.json',
            mode: '100644',
            type: 'blob',
            sha: finalStatsSha
        },
        {
            path: 'README.md',
            mode: '100644',
            type: 'blob',
            sha: rootReadmeSha
        }
    ];

    const newTree = await githubAPI(`${repoPath}/git/trees`, 'POST', {
        base_tree: baseTreeSha,
        tree: tree
    }, creds.githubToken);

    // 6. Create commit
    const commitMessage = `Add ${data.problem.title} - ${diffLevel}`;
    const newCommit = await githubAPI(`${repoPath}/git/commits`, 'POST', {
        message: commitMessage,
        tree: newTree.sha,
        parents: [latestCommitSha]
    }, creds.githubToken);

    // 7. Update reference
    await githubAPI(`${repoPath}/git/refs/heads/${branch}`, 'PATCH', {
        sha: newCommit.sha
    }, creds.githubToken);

    console.log("Successfully committed new submission!");
}
