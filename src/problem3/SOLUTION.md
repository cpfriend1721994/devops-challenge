It have 3 Scenario:
- First is maybe have problem on NGINX Service. Can check the /var/log/nginx/error.log of NGINX to look for any errors or warnings related to memory allocation or performance.

- Second if the problem is not come from NGINX Service but NGINX Service have high memory usage (using htop, top, pmap, ... to check), maybe check the /var/log/nginx/info.log to see why NGINX Service us huge memory (can be requests cache, static cache, ...) so to clear the unnecessary cache.

- Third if the VM running at high memory but not come from NGINX Service, check the process that use high memory then discover why this process use so much memory (any thing can happen, even the VM have unknown process, or hacker had create backdoor on server).

- To recover the NGINX Service, if high memory process is not NGINX (Third Scenario), immediately kill this process (kill -9 <PiD of unknown process>), if high memory process is NGINX, just reload NGINX (Second Scenario), if high memory process is NGINX and have error (First Scenario), fix this based on the error log. 